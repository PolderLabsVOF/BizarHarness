---
name: thinking-fermi-estimation
description: Use when you need a number you can't measure and can't look up. Decompose the unknown into estimable factors and multiply for an order-of-magnitude answer. Don't Fermi a lookup-able value.
---

# Fermi Estimation

## Overview

Fermi estimation, named after physicist Enrico Fermi, is the art of making reasonable estimates for quantities that seem impossible to know without direct measurement. By decomposing a question into factors you can estimate, then multiplying, you often get surprisingly accurate order-of-magnitude results.

**Core Principle:** Break the unknown into known (or estimable) pieces. Even rough estimates combine to reasonable accuracy due to errors canceling out.

## Trigger Card

When you need a number you can't measure or look up, and order-of-magnitude is enough:

1. **Decompose:** Quantity = Factor₁ × Factor₂ × ... × Factorₙ (by component, by rate×time, or by population×fraction).
2. **Estimate each factor** with a range, not a point; use geometric mean for order-of-magnitude; round to one significant figure.
3. **Multiply and sanity-check:** Does the order of magnitude make sense? Would a 10× error change the decision?
4. **Report:** "~X, within 3-5×" — never false precision.

If the number is lookup-able (COUNT(*), pricing page, profile it), do that instead — a made-up estimate where a real value exists is strictly worse.

## When to Use

- Capacity planning ("How much storage will we need?")
- Cost estimation ("What will this infrastructure cost?")
- Market sizing ("How many potential users exist?")
- Feasibility assessment ("Is this even plausible?")
- Sanity checking ("Does this number make sense?")
- Interview questions ("How many piano tuners in Chicago?")
- Quick prioritization ("Is this worth pursuing?")

Decision flow:

```
Need a number you don't have? → Can you measure OR look it up cheaply? → yes → DO THAT (don't Fermi it)
                                                                       ↘ no → Will an order-of-magnitude answer suffice? → yes → FERMI ESTIMATE
                                                                                                                          ↘ no → you need real data, go get it
```

## When NOT to Use

- **The number is cheaply lookup-able or measurable.** Don't Fermi the size of a table you can `COUNT(*)`, the latency you can profile, the file size you can `ls`, the price on a pricing page, or any fact one query/search away. A made-up estimate where a real value is available is strictly worse — it adds error and false confidence. Look it up.
- **You need precision, not order of magnitude.** Fermi gives you "~4 TB, within 3-5x." If the decision turns on 3.8 vs 4.2, estimation can't carry it — get the real number.
- **The factors are correlated or you'd be inventing the base rates.** If the decomposition is just stacked guesses with no anchor, the result is theater. Either find one real anchor or flag the whole thing as a rough guess.
- **The decision is identical across the plausible range.** If "somewhere between 1 GB and 1 TB" doesn't change what you do, skip the estimate and act.

## The Fermi Process

### Step 1: Clarify What You're Estimating

Be precise about the quantity:

```
Vague: "How big is the market?"
Precise: "How many SaaS companies with 50-500 employees in the US
         would pay $1000/month for our product?"
```

### Step 2: Decompose into Estimable Factors

Break into pieces you can estimate:

```
Storage needs for user data:
= (Number of users)
  × (Data per user per day)
  × (Days of retention)
  × (Overhead factor)
```

**Decomposition strategies:**

| Strategy | Example |
|----------|---------|
| By component | Total = Sum of parts |
| By rate × time | Total = Rate × Duration |
| By population × fraction | Target = Base × Percentage |
| By analogy × adjustment | New ≈ Similar × Ratio |

### Step 3: Estimate Each Factor

For each factor, estimate based on:

| Source | Example |
|--------|---------|
| Known data | "We have 10,000 DAU" |
| Industry benchmarks | "Average SaaS churn is 5%" |
| Physical constraints | "A human can make ~50 decisions/day" |
| Logical bounds | "At least 1, at most 1 million" |
| Personal experience | "I've seen systems handle 1000 req/s" |

**When estimating:**
- Use ranges, not point estimates: "10,000 to 50,000"
- Prefer geometric mean for order-of-magnitude: √(10,000 × 50,000) = 22,360
- Round to one significant figure: ~20,000

### Step 4: Combine Factors

Multiply (or add) factors together:

```
Storage = 50,000 users × 10 KB/user/day × 365 days × 1.5 overhead
        = 50,000 × 10,000 × 365 × 1.5 bytes
        = 274 billion bytes
        ≈ 270 GB/year
```

### Step 5: Sanity Check

Verify reasonableness:
- Does the order of magnitude make sense?
- Is it physically possible?
- Does it match any known data points?
- Would a 10x error change the decision?
- **Is any factor actually lookup-able?** If so, replace the estimate with the real value — every measured factor you substitute shrinks the error bars.

### Step 6: State Confidence and Implications

```
Estimate: ~270 GB/year
Confidence: Within 3-5x (80-1,500 GB)
Implication: Standard database tier sufficient; no special infrastructure needed
```

## Fermi Estimation Template

```markdown
# Fermi Estimate: [Question]

## Question (Precise)
[Exactly what we're estimating]

## Decomposition
[Quantity] = [Factor 1] × [Factor 2] × ... × [Factor N]

## Factor Estimates

### Factor 1: [Name]
- Estimate: [Value]
- Source/Reasoning: [Why this number]
- Confidence: High / Medium / Low

### Factor 2: [Name]
- Estimate: [Value]
- Source/Reasoning: [Why this number]
- Confidence: High / Medium / Low

[Continue for all factors...]

## Calculation
[Show the math]

## Result
- Point estimate: [Value]
- Range: [Low] to [High] (representing Xx uncertainty)

## Sanity Check
- Physical plausibility: [Check]
- Comparison to known data: [Check]
- Order of magnitude reasonable: [Check]

## Implications
[What does this estimate mean for the decision?]
```

## Common Decomposition Patterns

### Capacity Planning
```
Needed = Users × Usage/User × Factor/Usage × Growth × Safety
```

### Cost Estimation
```
Cost = Resources × Unit Cost × Duration × Overhead
```

### Time Estimation
```
Time = Tasks × Time/Task × (1 + Risk Factor)
```

### Market Sizing
```
Market = Population × Segment% × Adoption% × Price × Frequency
```

## Tips for Better Estimates

### Use Multiple Approaches

Estimate the same thing different ways:

```
Website traffic estimate:
Method 1: Bottom-up from user base
Method 2: Top-down from market share
Method 3: Analogy to similar company

If methods agree within 3x, confidence increases
If they diverge wildly, investigate assumptions
```

### Bound First

Start with upper and lower bounds:

```
"Definitely more than 1,000, definitely less than 10 million"
"So somewhere in 10,000-1,000,000 range"
"Let me narrow from there..."
```

### Watch for Correlated Errors

If factors are correlated, errors don't cancel:

```
BAD: Users × Revenue/User (both depend on same growth assumption)
BETTER: Estimate revenue directly, or use independent factors
```

### One Significant Figure

Don't false precision:

```
Calculation: 47,832,519 bytes
Report: ~50 MB (not "47.8 MB")
```

## Verification Checklist

- [ ] Question stated precisely
- [ ] Decomposed into 3-6 estimable factors
- [ ] Each factor has reasoning/source
- [ ] Factors are relatively independent
- [ ] Calculation shown and checked
- [ ] Result sanity-checked against reality
- [ ] Uncertainty range stated
- [ ] Implications for decision clarified

## Key Questions

- "Can I break this into smaller, estimable pieces?"
- "What do I already know that constrains this?"
- "What's the upper bound? Lower bound?"
- "Does this number pass the smell test?"
- "Would being off by 10x change my decision?"
- "Can I estimate this a different way to cross-check?"

## Fermi's Wisdom

When asked how many piano tuners were in Chicago, Fermi didn't look it up—he estimated from population, households, pianos, tuning frequency, and tuner capacity. His estimate was reportedly within 20% of the actual number.

The lesson: You know more than you think. Decompose, estimate, combine. The errors often cancel, and you get surprisingly close to truth.

"Never make a calculation until you know the answer." — John Wheeler (Fermi's colleague)

Meaning: Estimate first to know what answer to expect, then calculate to verify.
