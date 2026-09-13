"""Abundance-table parsing using only the standard library.

Replaces the previous pandas dependency. pandas was used for exactly two things
here, `read_csv` with delimiter sniffing and `to_numeric`, both of which the
stdlib `csv` module and `float()` handle directly.

Dropping it matters for deployment: pandas plus its dependencies add roughly
60 MB to the Lambda package, which is the difference between fitting in a zip
deployment and needing a container image. Removing it also removes a large
transitive dependency surface from a public endpoint.

Expected layout: first column holds taxon names, every remaining column is a
sample. Values may be counts or fractions; callers normalise afterwards.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from typing import Dict, List

# Delimiters we accept. Restricting the candidate set keeps sniffing cheap and
# predictable on untrusted input, rather than letting the sniffer consider any
# character.
CANDIDATE_DELIMITERS = ",\t;"


class TableError(ValueError):
    """Raised when a table cannot be parsed or violates a configured bound."""


@dataclass
class AbundanceTable:
    taxa: List[str]
    sample_names: List[str]
    # columns[i] holds the values for sample_names[i], aligned with taxa.
    columns: List[List[float]]

    def as_mapping(self, sample_index: int) -> Dict[str, float]:
        """{taxon: value} for one sample column."""
        values = self.columns[sample_index]
        out: Dict[str, float] = {}
        for i, taxon in enumerate(self.taxa):
            # Later duplicates of the same taxon name accumulate rather than
            # overwrite, which is the right behaviour for a profiler that emits
            # a genus more than once.
            out[taxon] = out.get(taxon, 0.0) + values[i]
        return out


def _sniff_delimiter(sample_text: str) -> str:
    """Detect the delimiter, falling back to comma."""
    try:
        dialect = csv.Sniffer().sniff(sample_text, delimiters=CANDIDATE_DELIMITERS)
        return dialect.delimiter
    except csv.Error:
        # Sniffer raises when it cannot decide. Prefer whichever candidate is most
        # frequent in the header, then comma.
        header = sample_text.splitlines()[0] if sample_text.splitlines() else ""
        best = max(CANDIDATE_DELIMITERS, key=header.count)
        return best if header.count(best) > 0 else ","


def _to_float(raw: str) -> float:
    """Parse a cell to a non-negative float, treating junk as zero.

    Mirrors the previous `to_numeric(errors="coerce").fillna(0)` behaviour, and
    rejects NaN/inf explicitly so they cannot propagate into the model.
    """
    text = (raw or "").strip()
    if not text:
        return 0.0
    try:
        value = float(text)
    except ValueError:
        return 0.0
    # NaN and infinities would corrupt normalisation and the log-ratio transform.
    if value != value or value in (float("inf"), float("-inf")):
        return 0.0
    return max(0.0, value)


def parse_table(
    text: str,
    max_rows: int,
    max_sample_columns: int,
) -> AbundanceTable:
    """Parse CSV/TSV text into an AbundanceTable, enforcing bounds while reading.

    Bounds are applied during iteration rather than afterwards, so an oversized
    file is rejected without ever being fully materialised.
    """
    # Sniff on a bounded prefix: enough to identify the delimiter, cheap on a
    # large or hostile input.
    delimiter = _sniff_delimiter(text[:8192])

    reader = csv.reader(io.StringIO(text), delimiter=delimiter)

    try:
        header = next(reader)
    except StopIteration as exc:
        raise TableError("File is empty.") from exc

    if len(header) < 2:
        raise TableError(
            "Expected at least a taxon column and one sample column."
        )

    sample_names = [h.strip() or f"Sample_{i + 1}" for i, h in enumerate(header[1:])]
    if len(sample_names) > max_sample_columns:
        raise TableError(
            f"Too many sample columns: {len(sample_names)} exceeds the limit of "
            f"{max_sample_columns}."
        )

    taxa: List[str] = []
    columns: List[List[float]] = [[] for _ in sample_names]

    for row in reader:
        if not row or all(not cell.strip() for cell in row):
            continue  # skip blank lines
        if len(taxa) >= max_rows:
            raise TableError(
                f"Too many rows: file exceeds the limit of {max_rows}."
            )
        taxon = (row[0] or "").strip()
        if not taxon:
            continue
        taxa.append(taxon)
        for i in range(len(sample_names)):
            # Ragged rows are tolerated: missing trailing cells read as zero.
            cell = row[i + 1] if i + 1 < len(row) else ""
            columns[i].append(_to_float(cell))

    if not taxa:
        raise TableError("No data rows found.")

    return AbundanceTable(taxa=taxa, sample_names=sample_names, columns=columns)


def parse_single_sample(
    text: str,
    max_rows: int,
    sample_column: str | None = None,
) -> Dict[str, float]:
    """Parse a table and return one sample column as {taxon: value}.

    Used by the HealthOmics ingest path, which analyses one sample at a time.
    """
    table = parse_table(text, max_rows=max_rows, max_sample_columns=1024)
    if sample_column is None:
        index = 0
    else:
        if sample_column not in table.sample_names:
            raise TableError(
                f"Sample column {sample_column!r} not found. "
                f"Available: {table.sample_names}"
            )
        index = table.sample_names.index(sample_column)
    return table.as_mapping(index)
