/**
 * All help-bubble copy lives here so it can be reviewed and tweaked in one place
 * before a talk, rather than being scattered through the components.
 *
 * Tone: assume a microbiome researcher is reading. State the biology, name the
 * caveat, and do not overclaim.
 */
import { P, T } from "./components/InfoBubble";

export const HELP = {
  verdict: (
    <>
      <P>
        A logistic-regression classifier scores the community as{" "}
        <T>Healthy</T> or <T>Dysbiotic</T>. Confidence is the model's
        probability for whichever label it picked.
      </P>
      <P>
        High confidence means the composition sits far from the decision
        boundary, not that the biology is certain. The model was trained on
        synthetic profiles, so treat this as a demonstration of the method
        rather than a diagnosis.
      </P>
    </>
  ),

  composition: (
    <>
      <P>
        Relative abundance of each taxon in this sample, as a share of the whole
        community. The centre shows the single most abundant taxon.
      </P>
      <P>
        <T>Assay assumption:</T> bacteria and fungi appear in one composition,
        which is only valid for shotgun metagenomics. 16S and ITS amplicon runs
        are normalised separately and cannot be merged into one set of
        proportions, and 16S recovers no <em>Malassezia</em> at all.
      </P>
    </>
  ),

  drivers: (
    <>
      <P>
        Each bar is one taxon's exact contribution to the call. Together they
        decompose the log-odds gap between this sample and the healthy
        reference, so the arithmetic is the model's own, not a post-hoc
        approximation.
      </P>
      <P>
        Direction combines two facts: how far the taxon sits from the healthy
        reference, and whether more of it is associated with dysbiosis. So
        depleted <em>S. epidermidis</em> and elevated <em>S. capitis</em> both
        push toward dysbiotic.
      </P>
      <P>
        Aggregated <T>Other</T> is excluded here. It is a mixture of unrelated
        taxa, so calling it a driver would not mean anything.
      </P>
    </>
  ),

  recommendations: (
    <>
      <P>
        The largest gaps between this sample and the healthy reference, phrased
        as shifts that would close them.
      </P>
      <P>
        Only gaps in a harmful direction appear: a protective taxon sitting
        above the reference is not flagged, and neither is a risk taxon sitting
        below it.
      </P>
      <P>
        This describes community composition. It is <T>not clinical advice</T>,
        and it says nothing about which product or treatment would achieve the
        shift.
      </P>
    </>
  ),

  radar: (
    <>
      <P>
        This sample's composition overlaid on the healthy reference profile, so
        deviations across all nine taxa are visible as one shape.
      </P>
      <P>
        Axes are raw percentages, so abundant taxa dominate the outline. A
        sample tracking the reference produces two nearly coincident shapes.
      </P>
    </>
  ),

  cutiStaph: (
    <>
      <P>
        <T>Cutibacterium : Staphylococcus.</T> The primary bacterial axis, and
        the best-supported single number here.
      </P>
      <P>
        Published healthy scalp means imply a ratio near <T>2.3</T>, with
        dandruff lesional sites falling below about <T>1.5</T>. That is a
        narrower window than the folk model suggests, so small movements matter.
      </P>
      <P>
        Denominators are floored at a 0.1% detection limit and the value is
        capped, so a sample with no detected <em>Staphylococcus</em> cannot
        render a meaningless six-figure ratio.
      </P>
    </>
  ),

  restrictaGlobosa: (
    <>
      <P>
        <T>M. restricta : M. globosa.</T> The fungal axis.
      </P>
      <P>
        Total <em>Malassezia</em> load is a poor discriminator: it dominates the
        mycobiome on healthy and dandruff scalps alike, with no significant
        difference in relative abundance. The signal sits in the species
        balance, where <em>M. restricta</em> rises and <em>M. globosa</em> falls
        at severe-flaking sites.
      </P>
      <P>Higher values indicate a shift away from the healthy balance.</P>
    </>
  ),

  epidermidisCapitis: (
    <>
      <P>
        <T>S. epidermidis : S. capitis.</T> A within-genus axis that a
        genus-level <em>Staphylococcus</em> feature would average away.
      </P>
      <P>
        Species-level qPCR shows <em>S. capitis</em> rising with dandruff
        severity while <em>S. epidermidis</em> falls. The genus-level increase
        is driven by <em>S. capitis</em>, so the two species carry opposite
        associations and must be modelled separately.
      </P>
      <P>Lower values indicate the protective species losing ground.</P>
    </>
  ),

  shannon: (
    <>
      <P>
        <T>Shannon index</T> summarises how evenly abundance is spread across
        taxa; evenness is the same quantity scaled to 0&ndash;1.
      </P>
      <P>
        <T>Read this as context, not as a verdict.</T> A healthy sebaceous scalp
        is dominated by <em>Cutibacterium</em>, so low diversity is the healthy
        baseline. The "low diversity means dysbiosis" rule comes from gut
        microbiome work and does not transfer here.
      </P>
      <P>
        Among the built-in profiles only post-antibiotic has genuinely reduced
        diversity. The seborrheic profile is more diverse than healthy.
      </P>
    </>
  ),

  samples: (
    <>
      <P>
        Four profiles the presenter can load instantly. Each is a fixed
        composition, so the numbers are identical every run.
      </P>
      <P>
        The three dysbiotic profiles represent <T>lesional sites</T>. That is
        deliberate: published community shifts reach significance at lesional
        sites, while whole-head averages differ far less.
      </P>
    </>
  ),

  upload: (
    <>
      <P>
        CSV or TSV, <T>rows = taxa, columns = samples</T>. The first column
        holds taxon names; every other column is analysed as its own sample.
        Delimiter is detected automatically, and counts work as well as
        fractions.
      </P>
      <P>
        Genus-level <em>Staphylococcus</em> or <em>Malassezia</em> is split
        across the modelled species using healthy-reference proportions, and the
        app tells you when it did so. That assumption{" "}
        <T>biases the call toward healthy</T>, because within-genus balance is
        where much of the signal sits. Unrecognised taxa fold into <T>Other</T>.
      </P>
      <P>
        This is the seam where a HealthOmics abundance table from S3 would drop
        in unchanged.
      </P>
    </>
  ),

  classifier: (
    <>
      <P>
        Relative abundances are compositional, so they are mapped through a{" "}
        <T>centred log-ratio (CLR)</T> transform before modelling. Ordinary
        statistics on raw proportions ignore the constraint that components sum
        to one.
      </P>
      <P>
        Logistic regression is used rather than a black box because its
        coefficients give an exact per-taxon decomposition, which is what the
        drivers panel reports.
      </P>
      <P>
        <T>The accuracy figure is a pipeline check, not validation.</T> It is
        measured on held-out samples from the same synthetic generator that
        produced the training data, so it confirms the model learned the
        structure it was given. No sequenced scalp samples were involved.
      </P>
    </>
  ),

  cohort: (
    <>
      <P>
        One chip per sample column in the file you uploaded. Click any chip to
        show that sample's full analysis below.
      </P>
      <P>
        The dot is the verdict at a glance: teal for healthy, rose for dysbiotic.
        Every sample is scored independently, so a file can mix both.
      </P>
    </>
  ),

  waterfall: (
    <>
      <P>
        Each bar is one taxon's contribution to the call, starting where the
        previous bar ended. Together they walk from the healthy reference's
        log-odds to this sample's.
      </P>
      <P>
        <T>This is exact, not an approximation.</T> The terms are the model's own
        arithmetic and sum to the log-odds gap, so the final bar lands on the
        sample's value with no plug figure. The residual shown in the corner is
        the proof: it should read as effectively zero.
      </P>
      <P>
        Log-odds are used rather than percentages because contributions add up in
        log-odds space and do not in probability space. The dashed line marks
        log-odds 0, which is P(dysbiotic) = 50%: the decision boundary.
      </P>
    </>
  ),

  ordination: (
    <>
      <P>
        The synthetic training cohort projected into two dimensions, with this
        sample marked as a star and the healthy reference as a cross.
      </P>
      <P>
        Axes are principal components of the <T>CLR-transformed</T> data, so
        Euclidean distance in this plot is <T>Aitchison distance</T> — the proper
        metric for compositional data, and the reason the pipeline uses a
        log-ratio transform at all.
      </P>
      <P>
        Two axes never capture everything. The percentages state how much
        variance each holds, so points that appear close may still differ on the
        components not shown. PC1 orientation is pinned so healthy is always on
        the left.
      </P>
    </>
  ),

  trajectory: (
    <>
      <P>
        Probability of dysbiosis as the community is shifted step by step from
        this sample toward the healthy reference. The marker shows where it
        crosses the decision boundary.
      </P>
      <P>
        The path is a <T>geodesic in Aitchison geometry</T>: linear interpolation
        of CLR coordinates, which in composition space means each step is a
        weighted geometric mean of the endpoints. Every intermediate point is
        therefore a valid composition, which a naive blend of percentages would
        not guarantee.
      </P>
      <P>
        <T>This is a simulated direction of travel.</T> It is not longitudinal
        data, it does not model any particular treatment, and the crossing point
        is a property of this model rather than a clinical milestone.
      </P>
    </>
  ),

  perturbation: (
    <>
      <P>
        Drag any taxon and the whole analysis recomputes: verdict, confidence,
        ratios, drivers, waterfall, and the sample's position in the ordination.
      </P>
      <P>
        Because abundances are compositional, raising one taxon <T>must</T> lower
        the others. The remaining taxa are rescaled proportionally to keep the
        total at 100%, so you are moving one taxon's share of a fixed whole, not
        adding material to the community.
      </P>
      <P>
        Useful as a test of the "what would help" panel: take the dandruff
        profile, pull <em>S. capitis</em> down toward its healthy value, and watch
        whether the verdict flips where the recommendation implies it should.
      </P>
    </>
  ),

  healthomicsDemo: (
    <>
      <P>
        Runs the real S3 ingest function against a taxonomic abundance table, and
        feeds the result through the same normalisation and analysis an upload
        would use.
      </P>
      <P>
        <T>No AWS account is involved.</T> boto3 is intercepted in-process by
        moto, so there are no network calls and no credentials, yet the code path
        executed is the production one.
      </P>
      <P>
        The demo table deliberately includes species outside the model
        (<em>Lawsonella</em>, <em>Rothia</em>) so you can see them aggregated into{" "}
        <T>Other</T> and reported in the data-quality notes.
      </P>
    </>
  ),

  warnings: (
    <>
      <P>
        Notes about how your input was interpreted: genus-level values that had
        to be split, taxon names that were not recognised, or a missing fungal
        component.
      </P>
      <P>
        These are not errors. They tell you which parts of the call rest on
        assumptions rather than on your data.
      </P>
    </>
  ),

  taxa: (
    <>
      <P>
        Nine modelled taxa. Two genera are deliberately split to species because
        their members carry opposite associations:{" "}
        <em>S. epidermidis</em> versus <em>S. capitis</em>, and{" "}
        <em>M. restricta</em> versus <em>M. globosa</em>.
      </P>
      <P>
        Real scalp surveys recover well over a hundred genera. Everything
        outside these nine is aggregated into <T>Other</T>.
      </P>
    </>
  ),
} as const;
