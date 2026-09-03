# EvolvePath Product Requirements Document

**Document:** `PRD.md`  
**Product:** EvolvePath  
**Status:** Product Definition / Engineering Planning  
**Version:** 1.0  
**Primary Audience:** Product, Design, Engineering, AI/ML, Data, QA, Safety  
**Companion Document:** `VISION.md`

> **Become who you want to be — one action at a time.**

---

# 1. Executive Summary

EvolvePath is an AI-native personal improvement application designed to help ordinary adults become more consistent, intentional, productive, present, and healthy across three connected areas of life:

1. **Work**
2. **Family**
3. **Health**

EvolvePath is not a task manager, fitness tracker, habit checklist, therapy application, or chatbot.

It is a **behavior-change system with a persistent AI coach**.

The fundamental problem EvolvePath solves is the gap between intention and behavior.

Users often know what they want:

- finish important work,
- stop procrastinating,
- exercise consistently,
- eat better,
- spend more intentional time with family,
- protect important relationships,
- become more disciplined,
- build routines that last.

But knowing what to do is insufficient.

People struggle because goals are vague, plans are unrealistic, actions are too large, motivation fluctuates, schedules change, friction appears, and one missed day often turns into abandonment.

EvolvePath converts aspiration into execution:

> **Aspiration → Outcome → Plan → Routine → Commitment → Action → Evidence → Reflection → Adaptation → Consistency → Change**

The application should always help the user answer:

> **Where am I?**

> **What matters today?**

> **What should I do next?**

> **Am I becoming the person I said I wanted to become?**

Artificial intelligence is central to EvolvePath, but the product must not become a generic AI chat interface.

The AI acts as:

- planner,
- coach,
- procrastination interrupter,
- workout programming assistant,
- pattern detector,
- reflection partner,
- recovery guide,
- plan adapter,
- notification copy generator,
- next-best-action reasoner.

The product itself owns:

- goals,
- plans,
- routines,
- schedules,
- workout programs,
- commitments,
- completions,
- evidence,
- plan versions,
- user preferences,
- notification policies,
- durable memory.

The defining architecture principle is:

> **EvolvePath owns the plan. AI owns the coaching.**

And:

> **Deterministic state. Probabilistic intelligence.**

---

# 2. Product Mission

EvolvePath exists to help people repeatedly behave more like the person they want to become.

The objective is not to maximize time spent in the application.

The objective is to improve meaningful real-world behavior.

A successful EvolvePath session may last less than one minute:

> Open → Understand → Act → Leave.

The long-term success condition is that the user increasingly performs desired behaviors with **less dependence on EvolvePath intervention**.

---

# 3. Problem Statement

## 3.1 The intention-action gap

A user may sincerely intend to:

- train three times this week,
- complete an important proposal,
- put their phone away during dinner,
- prepare lunches,
- call a parent,
- go to bed earlier.

Yet the intended behavior does not occur.

Research on intention and behavior consistently demonstrates that stronger intentions do not translate perfectly into action. Planning interventions, particularly specific action plans and implementation intentions, can help close that gap.

EvolvePath therefore cannot stop at goal setting.

Every meaningful goal must eventually become an executable behavior in a specific context.

## 3.2 Procrastination is not primarily a task-storage problem

Traditional productivity systems assume that once a task is captured, the user will perform it.

For procrastinators, that assumption is false.

The user may repeatedly avoid a task because:

- the action is unclear,
- it is emotionally uncomfortable,
- it feels too large,
- the reward is delayed,
- perfectionism raises the perceived cost,
- energy is low,
- the user does not know where to begin,
- the user expects the task to be unpleasant,
- another activity provides easier immediate reward.

EvolvePath must therefore treat **starting** as a first-class product capability.

## 3.3 Plans fail in real life

Most planning systems are optimistic.

Users build plans while motivated.

Then:

- meetings appear,
- children need attention,
- travel happens,
- sleep is poor,
- work emergencies arise,
- motivation disappears,
- routines conflict.

EvolvePath must assume disruption is normal.

Plans should contain:

- ideal action,
- reduced action,
- fallback action,
- rescheduling behavior,
- recovery behavior.

## 3.4 Existing products fragment the user

A productivity application optimizes Work.

A workout application optimizes Health.

A family calendar optimizes logistics.

A habit tracker optimizes repetition.

The user has one life.

They have one calendar, one attention budget, one energy budget, and one set of competing priorities.

EvolvePath must understand the relationship between domains.

Example:

A user has:

- a major presentation Tuesday,
- business travel Thursday,
- a child's birthday Friday.

The correct recommendation may be:

> Work receives extra emphasis Monday and Tuesday. Health moves into maintenance mode. Family becomes the dominant priority Friday through Sunday.

This cannot be achieved by three independent applications issuing independent recommendations.

---

# 4. Target User

## 4.1 Primary persona

The primary EvolvePath user is:

- an adult,
- busy,
- interested in self-improvement,
- capable of understanding what they should generally do,
- inconsistent at executing it,
- likely to procrastinate,
- frequently overcommitted,
- not interested in making self-optimization a full-time hobby,
- willing to receive coaching and reminders,
- comfortable using AI.

They may describe themselves as:

> “I know what I should do. I need help actually doing it.”

## 4.2 Primary user archetypes

### The Capable Procrastinator

Competent and successful, but delays important difficult work.

Needs:

- task decomposition,
- activation support,
- focus starts,
- accountability,
- pattern recognition.

### The Repeated Restarter

Frequently begins diets, workout routines, productivity systems, or habits and abandons them.

Needs:

- smaller plans,
- sustainable pacing,
- relapse recovery,
- continuity without shame.

### The Overloaded Parent

Wants to perform well professionally, be present for family, and maintain health.

Needs:

- cross-domain prioritization,
- realistic scheduling,
- protected family commitments,
- flexible workout plans.

### The Inconsistent Exerciser

Wants health and strength, but does not need athlete-level optimization.

Needs:

- simple programs,
- workout tracking,
- progression,
- fallback workouts,
- adherence coaching.

---

# 5. Non-Target Users

EvolvePath is not optimized primarily for:

- professional athletes,
- competitive bodybuilders,
- extreme endurance athletes,
- quantified-self enthusiasts requiring advanced biometric modeling,
- users seeking diagnosis or treatment of mental illness,
- users seeking medical advice,
- users seeking couples therapy,
- users seeking detailed enterprise project management,
- users who only want a traditional task manager,
- users who only want a calorie database,
- users who only want an AI chatbot.

Wearables may be optional future inputs.

They are not foundational dependencies.

---

# 6. Product Outcomes

EvolvePath should improve:

### Behavior execution

The percentage of meaningful planned actions that become actual behavior.

### Consistency

The user's ability to repeat intended behavior over time.

### Recovery

The user's ability to return quickly after misses.

### Planning quality

The realism of plans created over time.

### Self-efficacy

The user's belief that they can reliably perform behaviors they intend.

### Independence

The user's ability to act with progressively fewer interventions.

---

# 7. Core Product Principles

## P1. The user's life is the product

Optimize for actions outside the application.

## P2. The next useful action beats another insight

Reflection that does not improve action is incomplete.

## P3. Plans are first-class objects

A commitment cannot disappear into chat history.

## P4. Start matters

Starting should be measurable separately from finishing.

## P5. A failed plan is information

Repeated misses should change the plan.

## P6. Recovery is part of success

Returning after a lapse is itself a meaningful behavior.

## P7. Small actions must remain legitimate

A difficult day should still allow useful progress.

## P8. Reduce scope before increasing pressure

When repeated failure occurs, test whether the plan is wrong before blaming motivation.

## P9. One life, one coach

Work, Family, and Health must share context.

## P10. Notifications must earn the interruption

The goal is behavior, not app opens.

## P11. AI everywhere, chatbot nowhere

Intelligence should be embedded throughout product flows.

## P12. Deterministic state, probabilistic intelligence

The model reasons over truth; it does not invent truth.

## P13. Measure behavior, not human worth

No score should imply that the user's value as a person is being measured.

## P14. Successful coaching should eventually require less coaching

Reduced intervention dependence is positive.

---

# 8. Evidence-Informed Behavior Change Model

EvolvePath should not claim that a single behavior-change theory explains all human behavior.

Instead, the product should operationalize techniques with useful empirical support.

## 8.1 Behavior Change Technique mapping

The system should maintain an internal taxonomy of interventions based on established behavior-change techniques.

Priority techniques include:

- goal setting,
- action planning,
- implementation intentions,
- prompts and cues,
- self-monitoring,
- feedback on behavior,
- problem solving,
- graded tasks,
- reducing negative emotional friction,
- restructuring environment,
- habit formation,
- social support,
- commitment,
- review of goals,
- review of behavior,
- rewards and celebration,
- identity-linked framing where appropriate.

The user does not need to see academic terminology.

The product should know which technique it is attempting.

## 8.2 Implementation intentions

EvolvePath should frequently convert plans into:

> **When X happens, I will do Y.**

Examples:

> After I make my morning coffee, I will open the proposal and work for 20 minutes before checking email.

> When dinner is served, my phone goes on the kitchen counter.

> Monday, Wednesday, and Friday after breakfast, I begin the planned workout.

These implementation rules should be stored structurally.

## 8.3 Capability, opportunity, motivation

When a behavior repeatedly fails, the AI should reason across three broad sources of friction:

### Capability

Can the user realistically perform the behavior?

Examples:

- doesn't know how,
- task too complex,
- exercise inappropriate,
- unclear first step.

### Opportunity

Does the environment permit it?

Examples:

- no time,
- wrong location,
- unavailable equipment,
- conflicting family commitment.

### Motivation

Is the user willing to perform it at that moment?

Examples:

- avoidance,
- low perceived reward,
- fear,
- boredom,
- emotional discomfort.

The intervention should match the friction.

Do not respond to every miss with motivation.

## 8.4 Autonomy

The coach should support user agency.

The AI can challenge the user, but plans should ultimately be owned by the user.

Recommendations should often use:

> “I recommend…”

instead of:

> “You must…”

The user should understand why important changes are proposed.

---

# 9. Conceptual Model

The application's core hierarchy is:

```text
Best Self
   ↓
Domains
   ↓
Outcomes
   ↓
Plans
   ↓
Routines / Strategies
   ↓
Commitments
   ↓
Actions
   ↓
Evidence
   ↓
Reflection
   ↓
Adaptation
```

This hierarchy must be represented explicitly in the product.

---

# 10. Core Persistent Data Objects

The following are product concepts, not necessarily final database tables.

## 10.1 UserProfile

Contains:

- user_id
- display_name
- timezone
- locale
- onboarding_state
- account preferences
- privacy preferences
- default coaching style
- notification permissions
- quiet hours

## 10.2 BestSelfProfile

Represents who the user wants to become.

Fields:

- identity_statement
- work_identity
- family_identity
- health_identity
- six_month_vision
- motivations
- reasons
- created_at
- last_reviewed_at

Example:

```json
{
  "identity_statement": "Focused, present, and healthy",
  "work_identity": "I start important work before becoming reactive",
  "family_identity": "I protect meaningful attention for my family",
  "health_identity": "I train consistently and eat in a way I can sustain"
}
```

## 10.3 Domain

Enum:

- WORK
- FAMILY
- HEALTH

Potential future domains must not be added until validated.

## 10.4 Outcome

Represents a meaningful result.

Fields:

- outcome_id
- domain
- title
- description
- target_date
- importance
- motivation
- state
- success_definition
- user_confidence
- archived_at

Examples:

Work:

> Deliver first draft of strategy by September 18.

Family:

> Create a reliable Sunday family planning ritual.

Health:

> Complete three strength workouts per week for six weeks.

## 10.5 Plan

A persistent strategy for achieving an outcome.

Fields:

- plan_id
- outcome_id
- version
- active_from
- active_until
- status
- rationale
- expected_effort
- expected_weekly_load
- fallback_strategy
- user_approved
- created_by
- previous_plan_id

Every major AI-recommended change creates a new PlanVersion.

## 10.6 Routine

A repeatable sequence.

Fields:

- routine_id
- plan_id
- title
- domain
- trigger_type
- trigger_value
- frequency
- preferred_time
- estimated_duration
- minimum_duration
- fallback_behavior
- active

Example:

```text
Morning Focus Routine
Trigger: after morning coffee
Frequency: weekdays
Ideal: 45 min
Minimum: 10 min
Fallback: outline one section of highest-priority work
```

## 10.7 Commitment

A specific future intention.

Fields:

- commitment_id
- source_plan_id
- domain
- title
- scheduled_start
- scheduled_end
- importance
- commitment_type
- full_version
- short_version
- minimum_version
- status
- reschedule_count
- skip_reason
- user_confirmed

Statuses:

- PLANNED
- READY
- STARTED
- COMPLETED
- PARTIALLY_COMPLETED
- RESCHEDULED
- SKIPPED
- MISSED
- CANCELLED

## 10.8 Action

The smallest executable unit.

Examples:

> Open proposal and write the decision statement.

> Start Dumbbell Bench Press set 1.

> Put phone on kitchen counter.

Actions can be generated dynamically but important actions should be persisted if they become commitments.

## 10.9 Evidence

Represents observed execution.

Fields:

- evidence_id
- commitment_id
- evidence_type
- timestamp
- quantitative_value
- qualitative_value
- source
- confidence

Sources:

- USER_LOG
- TIMER
- WORKOUT_LOG
- APP_FLOW
- CALENDAR_FUTURE
- INTEGRATION_FUTURE

The product should not pretend planned calendar events are completion evidence.

## 10.10 Reflection

Fields:

- reflection_id
- related_object
- user_text
- AI_summary
- friction_tags
- mood_optional
- perceived_difficulty
- satisfaction
- created_at

Reflections should be optional and lightweight.

## 10.11 Obstacle

Known recurring friction.

Fields:

- obstacle_type
- description
- domain
- observed_count
- confidence
- last_observed
- intervention_history

Examples:

- EVENING_WORKOUT_UNRELIABLE
- AMBIGUOUS_WORK_TASK
- FAMILY_PLAN_COLLIDES_WITH_WORK
- OVERCOMMITMENT
- PERFECTIONISM
- LOW_ENERGY_WINDOW

## 10.12 MemoryInsight

Durable AI coaching memory.

Fields:

- memory_id
- category
- statement
- evidence_count
- confidence
- user_confirmed
- expires_at_optional
- created_at
- updated_at

Example:

> Morning workouts have been substantially more reliable than workouts scheduled after 6 PM.

Durable behavioral inferences should usually require explicit user approval before becoming strong planning assumptions.

## 10.13 CoachPreference

Fields:

- coaching_style
- preferred_directness
- celebration_level
- reflection_frequency
- reminder_tolerance
- challenge_avoidance
- preferred_language
- preferred_message_length

Coaching style options:

- GENTLE
- BALANCED
- DIRECT

---

# 11. Application Navigation

Recommended primary mobile navigation:

1. **Today**
2. **Path**
3. **Coach**
4. **Progress**
5. **Profile**

Health workout execution may temporarily replace bottom navigation while a workout is active.

---

# 12. Today Screen

The Today screen is the product's primary surface.

It must answer:

- What matters today?
- What should I do now?
- What can wait?
- Am I on track?

## 12.1 Required components

### Greeting and state

Example:

> Good morning, Alex.

Optional contextual summary:

> Three commitments today. Health is in maintenance mode this week.

### Next Best Action

One primary recommended action.

Example:

> **Start the proposal storyline**
>
> 20 minutes · Work
>
> You have postponed this twice. Starting matters more than finishing right now.

CTA:

`Start 20 min`

Secondary:

`Make it smaller`

### Domain commitments

Work / Family / Health cards.

### Momentum summary

Show trends, not human score.

### Coach insight

One concise observation when useful.

### Quick add

Allow user to add:

- commitment,
- workout,
- family intention,
- work action.

---

# 13. Next Best Action Engine

EvolvePath should calculate a ranked set of candidate actions.

## 13.1 Inputs

- active outcomes
- active plans
- today's commitments
- deadlines
- importance
- reschedule count
- completion history
- current time
- expected duration
- stated availability
- domain balance
- known obstacles
- user's historical success windows
- recent misses
- coaching state

## 13.2 Candidate scoring

Initial deterministic ranking may consider:

```text
priority_score =
  importance_weight
  + urgency_weight
  + repeated_avoidance_weight
  + plan_relevance_weight
  + domain_balance_weight
  + contextual_fit_weight
  - effort_mismatch_penalty
  - conflict_penalty
  - fatigue_penalty
```

The AI should not freely invent priority.

The deterministic engine generates candidates.

The LLM may reason about trade-offs among candidates and explain the recommendation.

## 13.3 Output

The engine returns:

- recommended action,
- rationale,
- suggested duration,
- fallback action,
- intervention mode,
- confidence.

---

# 14. AI System Architecture

EvolvePath should use multiple logical AI responsibilities rather than one unconstrained assistant.

They may use the same underlying model initially.

## 14.1 Context Assembler

Builds the minimum relevant context for each AI call.

Context may include:

- Best Self
- active outcomes
- current plans
- recent evidence
- unresolved commitments
- recurring obstacles
- relevant memory insights
- coaching preference
- domain balance
- current time
- recent notification history

Avoid sending the entire conversation history.

## 14.2 Planning Reasoner

Responsibilities:

- convert aspiration into outcome,
- convert outcome into behavioral plan,
- propose realistic weekly load,
- build fallback behavior,
- create implementation intentions,
- identify conflicts,
- estimate complexity,
- recommend reduction when plan is excessive.

The Planning Reasoner must return structured proposals.

It does not directly mutate production state.

## 14.3 Coaching Reasoner

Responsibilities:

- explain next action,
- diagnose friction,
- respond to avoidance,
- decide when to encourage,
- decide when to challenge,
- conduct brief check-ins,
- help user recover.

## 14.4 Pattern Analysis Service

Runs periodically on behavioral history.

Outputs possible insights:

- time-of-day reliability,
- domain overload,
- repeated rescheduling,
- successful fallback usage,
- recovery latency,
- adherence by weekday,
- action-duration mismatch,
- notification responsiveness.

Insights should distinguish:

- observation,
- inference,
- recommendation.

## 14.5 Workout Programming Reasoner

Responsibilities:

- create normal-user workout programs,
- select exercises,
- choose sets and rep ranges,
- provide alternatives,
- design short/minimum sessions,
- recommend progression based on logged history,
- modify plans when time availability changes.

It must operate inside safety rules.

## 14.6 Weekly Review Reasoner

Input:

- previous week's plan,
- commitments,
- completion evidence,
- misses,
- reasons,
- workouts,
- notification interactions,
- domain balance.

Output:

1. what worked,
2. what did not,
3. what patterns were observed,
4. plan changes proposed,
5. what should remain unchanged,
6. what should not be added yet.

## 14.7 Notification Copy Generator

Generates personalized copy only after a deterministic notification decision permits a message.

Input:

- event type,
- domain,
- context,
- coaching style,
- prior message wording,
- current journey state.

Output:

- title,
- body,
- action label,
- deep link.

The LLM does not decide whether notification limits may be violated.

## 14.8 Safety Layer

Evaluates health, eating, emotional distress, relationship, and professional-sensitivity requests.

Safety policy may:

- allow,
- allow with conservative framing,
- restrict,
- redirect,
- escalate to professional care guidance where appropriate.

---

# 15. AI Mutation Protocol

AI recommendations must not silently rewrite user plans.

For plan-changing operations:

1. AI produces proposal.
2. Product displays diff.
3. User approves or edits.
4. Plan service validates.
5. New plan version becomes active.
6. Previous plan remains in history.
7. Change event is recorded.

Example:

> **I recommend changing your Health plan**
>
> Wednesday 6:30 PM workout → Saturday 9:00 AM
>
> Reason: You missed 3 of the last 4 Wednesday evening sessions.
>
> `Accept`
> `Edit`
> `Keep current plan`

Small ephemeral adaptations may happen automatically when already pre-authorized.

Example:

> User previously authorized a 10-minute fallback if fewer than 20 minutes remain.

---

# 16. AI Response Contracts

Critical AI operations should produce validated structured output.

Example conceptual contract:

```json
{
  "intervention_type": "REDUCE_ACTIVATION_ENERGY",
  "reasoning_summary": "Task has been rescheduled three times and remains large and ambiguous.",
  "recommended_action": {
    "title": "Write the opening decision statement",
    "duration_minutes": 10
  },
  "fallback_action": {
    "title": "Open the document and write three bullet points",
    "duration_minutes": 5
  },
  "user_message": "Forget finishing the deck. Give me ten minutes to establish the decision and three supporting points."
}
```

Internal chain-of-thought must never be exposed.

The user receives concise rationale, not model scratch work.

---

# 17. AI Memory Design

Memory should have multiple tiers.

## Tier 1 — Current state

Always authoritative:

- active plans,
- today's commitments,
- current workout program.

Stored deterministically.

## Tier 2 — Recent episodic context

Examples:

- last 14 days,
- recent misses,
- recent reflections,
- recent notification responses.

## Tier 3 — Durable user preferences

Examples:

- morning workouts more successful,
- direct coaching preferred,
- Sunday family planning works well.

Durable inferences should be inspectable and removable.

## Tier 4 — Conversation history

Searchable when needed.

Should not be the primary planning state.

---

# 18. AI Trust Requirements

The AI must:

- separate facts from recommendations,
- explain meaningful plan changes,
- not claim completion without evidence,
- not invent family information,
- not diagnose illness,
- not represent itself as a therapist,
- not fabricate workout history,
- not silently change goals,
- not encourage extreme eating or exercise,
- preserve user control.

---

# 19. Onboarding Experience

The objective of onboarding is to create the user's first realistic EvolvePath.

It must not feel like a form.

It should be conversational, visual, and progressive.

Target initial onboarding duration:

**5–8 minutes**

The user should exit with:

- Best Self statement,
- one initial outcome per selected domain,
- initial weekly commitments,
- coaching preference,
- notification permission strategy,
- first next action.

---

# 20. Onboarding Flow

## Step 1 — Promise

Screen:

> **Become who you want to be.**
>
> EvolvePath helps turn the things you keep meaning to do into a realistic plan you can actually follow.

CTA:

`Build my Path`

## Step 2 — Six-month vision

Prompt:

> Imagine six months from now your life is meaningfully better. What is different?

Voice and text should both be available.

AI extracts candidate themes.

## Step 3 — Domain reflection

Three cards:

### Work

> How would you like to work differently?

### Family

> How would you like to show up differently for the people you care about?

### Health

> What would feeling healthier look like in your real life?

Users may begin with fewer than three domains.

Do not force three major goals.

## Step 4 — Current reality

Ask only high-value questions.

Examples:

> What usually gets in the way?

Selectable:

- I procrastinate
- I make plans that are too ambitious
- I forget
- My schedule changes
- I lose motivation
- I get overwhelmed
- I don't know what to do
- Other

## Step 5 — Time reality

Ask:

> On a normal weekday, how much deliberate time can you realistically invest in improving these areas?

This helps prevent overload.

## Step 6 — Health baseline

If Health selected:

Ask:

- exercise experience,
- available days,
- approximate time,
- equipment,
- preferences,
- limitations disclosed by user.

Avoid unnecessary medical data.

## Step 7 — Coaching style

> When I notice you avoiding something, how should I respond?

Options:

**Gentle**  
Help me find an easier way back.

**Balanced**  
Encourage me, but remind me what I committed to.

**Direct**  
Call out avoidance and push me to start.

## Step 8 — AI plan proposal

Show:

# Your first Path

### Work
One initial outcome.

### Family
One initial commitment.

### Health
One initial routine.

Then:

> “I intentionally kept this smaller than what you asked for. I want the first plan to survive a bad week.”

CTA:

`Start this Path`

Secondary:

`Adjust`

## Step 9 — Notification value exchange

Do not request notification permission with generic OS copy immediately.

Explain:

> EvolvePath works best when I can remind you at moments you already decided matter — before your workout, when a focus block is about to start, or when a commitment is slipping.

Then request permission.

---

# 21. Progressive Profiling

The application should continue learning after onboarding.

Only ask a question when:

- answer will affect a recommendation,
- answer will improve personalization,
- user context has changed,
- pattern confidence is low.

Examples:

> You complete Tuesday workouts consistently but not Friday. Is Friday usually more unpredictable?

---

# 22. Work Domain Requirements

Work is a behavior-execution system, not a replacement for enterprise task management.

---

# 23. Work Outcomes

Users should be able to create outcomes such as:

- finish a proposal,
- complete certification,
- prepare a presentation,
- reduce reactive email behavior,
- establish morning deep work,
- complete weekly planning.

Outcomes must have:

- why it matters,
- target state,
- target date optional,
- current confidence.

---

# 24. Work Planning

AI should convert an outcome into:

- milestones,
- planned sessions,
- implementation triggers,
- minimum starts,
- review cadence.

Example:

Outcome:

> Finish strategy presentation Friday.

Plan:

Monday:
> 25 min — storyline

Tuesday:
> 45 min — evidence

Wednesday:
> 30 min — draft slides

Thursday:
> 30 min — revise

Friday:
> 15 min — final review

Each session becomes a Commitment.

---

# 25. Anti-Procrastination Detection

Potential avoidance signals:

- repeated rescheduling,
- repeatedly opening/editing without starting,
- unchanged task across multiple days,
- repeated short skips,
- user explicitly saying “later,”
- high-priority task consistently displaced by lower-priority work.

Avoidance must not be inferred solely from one miss.

---

# 26. Anti-Procrastination Intervention Ladder

## Level 0 — Normal reminder

> Proposal focus block starts in 15 minutes.

## Level 1 — Activation reduction

> Start for ten minutes.

## Level 2 — Decomposition

> Write only the first three bullets.

## Level 3 — Friction diagnosis

> You have moved this twice. What is making it hard to begin?

## Level 4 — Environment change

> Put email and Slack aside for 15 minutes.

## Level 5 — Plan challenge

> This keeps failing at 4 PM. I recommend moving the work to tomorrow morning.

## Level 6 — Goal challenge

> You have repeatedly deprioritized this for three weeks. Does this still matter enough to remain an active goal?

---

# 27. “Start” Flow

When user taps Start:

Screen displays:

- action title,
- why it matters,
- timer optional,
- one-sentence instruction,
- stop/continue controls.

Example:

> **Start the strategy storyline**
>
> For the next 10 minutes:
>
> 1. State the decision.
> 2. Write three supporting arguments.
> 3. Ignore formatting.

CTA:

`Begin 10:00`

At completion:

> Continue another 15 minutes?

Options:

`Continue`  
`Done for now`

Starting counts as evidence distinct from completing.

---

# 28. Work Focus Sessions

EvolvePath may provide lightweight focus timing.

Not a full Pomodoro application.

Capabilities:

- 5 / 10 / 20 / custom minutes,
- silent timer,
- optional distraction note,
- continuation option,
- completion evidence.

---

# 29. Work Weekly Review

Show:

- planned focus sessions,
- completed starts,
- completed meaningful outcomes,
- repeatedly postponed commitments,
- successful time windows.

AI example:

> “You completed 4 of 5 focus sessions scheduled before 9 AM and only 1 of 4 after 4 PM. Next week I recommend protecting mornings for high-friction work.”

---

# 30. Family Domain Requirements

The Family domain exists to help the user behave consistently with their own relationship values.

It must not attempt to quantify the quality of loved ones.

---

# 31. Family Outcome Types

Examples:

- protect family dinner,
- schedule weekly date time,
- create one-on-one time with children,
- call parents,
- improve family planning,
- establish bedtime ritual,
- plan monthly outing,
- protect device-free time.

---

# 32. Family Commitment Model

A commitment should emphasize the user's behavior.

Good:

> Put phone away during dinner.

Good:

> Spend 20 minutes helping child with project.

Good:

> Plan Saturday outing by Thursday.

Avoid:

> Make spouse happier.

Avoid:

> Improve daughter's attitude.

The system cannot control another person's behavior.

---

# 33. Family Privacy

Family profiles must be minimal.

If user creates family members, store only data required for useful planning:

- name or nickname,
- relationship,
- optional birthday,
- optional recurring routines,
- user-entered important events.

Do not infer sensitive psychological profiles.

Do not create hidden assessments of family members.

---

# 34. Family Rituals

Users can create recurring rituals.

Example:

```text
Sunday Family Planning
Every Sunday at 5 PM
Ideal duration: 20 min
Minimum: 5 min
Purpose: review the week and protect important family time
```

---

# 35. Family Review

The app may show:

> Planned family commitments: 4  
> Kept: 3

But should avoid gamified judgment.

AI may say:

> “Work displaced two evening family commitments this month. Do you want to protect those times more aggressively, or is the current trade-off intentional?”

---

# 36. Health Domain Requirements

Health should optimize sustainable behavior for normal users.

Core areas:

1. Exercise
2. Basic movement
3. Nutrition behavior
4. Recovery routines
5. Optional weight tracking

---

# 37. Workout Program Builder

Users should be able to ask:

> “Build me a three-day strength program. I have 40 minutes and use a commercial gym.”

Required input:

- goal,
- experience,
- days/week,
- time/session,
- equipment,
- preferences,
- limitations disclosed by user.

Output:

- program name,
- weekly structure,
- workouts,
- exercises,
- sets,
- rep ranges,
- rest,
- progression method,
- substitutions,
- full / short / minimum versions.

---

# 38. Workout Program Persistence

Workout plans must be stored structurally.

Example:

```text
Program: Stronger 3-Day
Week structure:
  Monday: Upper A
  Wednesday: Lower
  Friday: Upper B
Duration: 6 weeks
```

Each workout contains ordered exercises.

---

# 39. Exercise Object

Fields:

- exercise_id
- name
- equipment
- movement_pattern
- instructions
- contraindication_tags
- substitution_group
- media_reference_future

---

# 40. Workout Template

Fields:

- workout_id
- program_id
- title
- target_duration
- minimum_duration
- exercises
- fallback_workout_id

---

# 41. Workout Session Experience

When workout begins:

### Header

Upper A  
Workout 3 of 18

### Current exercise

Dumbbell Bench Press

Last time:

> 55 lb × 10, 10, 9

Today:

Set 1:
- Weight
- Reps
- RPE optional

CTA:

`Complete set`

Rest timer starts.

---

# 42. Workout Progression

Progression should initially use conservative deterministic rules.

Example double progression:

Target:

> 3 × 8–12

If user completes all sets at top of range with acceptable difficulty:

> suggest small load increase next session.

If user repeatedly fails lower bound:

> maintain or reduce.

The AI can explain.

The core progression rule should not be reinvented by the LLM every workout.

---

# 43. Workout Adaptation

AI should adapt when:

- available days change,
- session duration repeatedly exceeds user's capacity,
- exercise is repeatedly skipped,
- user dislikes exercise,
- equipment unavailable,
- user reports discomfort,
- user travels.

Example:

> “Your 55-minute lower-body day has been skipped twice. I recommend moving the accessory work to another session and reducing this workout to 35 minutes.”

---

# 44. Workout Fallbacks

Every scheduled workout should support:

### Full

Target training stimulus.

### Short

Preserves major movements.

### Minimum

Behavioral continuity.

Example:

Full: 45 min  
Short: 25 min  
Minimum: 10 min

The system must make clear they are not physiologically equivalent.

---

# 45. Pain and Injury Safety

If user reports:

- sharp pain,
- significant injury,
- concerning symptoms,
- neurological symptoms,
- severe exercise intolerance,

the coach should not simply modify programming as if the issue were ordinary fatigue.

It should recommend appropriate professional evaluation.

---

# 46. Nutrition Behavior

Initial product should focus on behaviors, not advanced nutrition analytics.

Supported behaviors:

- planned breakfast,
- meal preparation,
- protein target behavior,
- vegetables,
- water,
- reducing late-night eating,
- weekday meal planning,
- restaurant strategy,
- planned snacks.

Optional later:

- calorie tracking,
- food photo logging,
- macronutrients.

These should not dominate V1.

---

# 47. Weight Tracking

Optional.

User may log body weight.

UI should emphasize trend rather than daily emotional judgment.

Potential display:

> 30-day trend.

Avoid:

> “Bad day” based on one measurement.

---

# 48. Cross-Domain Planning

The user should not receive independent plans that exceed realistic capacity.

Weekly planning must estimate total intentional effort.

Example:

Work: 4 focus sessions  
Family: 3 commitments  
Health: 3 workouts

If the user attempts to add substantial new behaviors:

> “You already have eight recurring commitments this week. I recommend replacing something rather than adding another habit.”

---

# 49. Domain Modes

Each domain may temporarily operate in one of four modes:

### GROW

Actively improving.

### MAINTAIN

Preserving established behavior.

### RECOVER

Rebuilding after lapse.

### PAUSE

Intentional temporary pause.

This supports realistic life trade-offs.

Example:

During major business travel:

Work: GROW  
Family: MAINTAIN  
Health: MAINTAIN

---

# 50. Weekly Planning

Weekly planning is a core ritual.

Recommended day/time chosen by user.

Flow:

1. Review previous week.
2. Identify fixed constraints.
3. Select one primary focus.
4. Confirm domain modes.
5. Propose commitments.
6. Check workload.
7. Approve next week.

---

# 51. Weekly Review Screen

Structure:

# Your Week

### Work

4 / 5 meaningful commitments

### Family

2 / 3 commitments

### Health

3 / 3 workouts

### What worked

AI summary.

### What got in the way

AI summary.

### Pattern

One high-confidence insight.

### Recommendation

One or two changes.

### Next week

Plan diff.

CTA:

`Approve next week`

---

# 52. Momentum System

EvolvePath should avoid a single “quality of life” score.

Instead provide domain momentum.

States:

- BUILDING
- IMPROVING
- STEADY
- SLIPPING
- RECOVERING
- INSUFFICIENT_DATA

---

# 53. Momentum Inputs

Potential signals:

- planned vs completed,
- recovery after miss,
- repeated postponement,
- routine stability,
- recent trend,
- fallback completion,
- amount of intervention required.

The exact formula should remain deterministic and testable.

---

# 54. Momentum Presentation

Good:

> **Health Momentum: Improving**
>
> 5 of 6 planned workouts completed.  
> Returned one day after a miss.

Avoid:

> Health Score: 77/100.

Momentum explains behavior.

It does not evaluate human worth.

---

# 55. Consistency and Streak Philosophy

EvolvePath should learn from the effectiveness of visible continuity without making streak loss destructive.

Recommended system:

### Consistency Run

Count consecutive successful **weeks**, not necessarily perfect days.

Example:

> 4 weeks building momentum.

### Grace

A week may remain successful if important behavior remains above a threshold.

### Recovery

Show:

> Returned in 1 day.

### Milestones

Celebrate:

- first full week,
- four weeks,
- ten workouts,
- first successful comeback,
- first month with reduced reminders.

Daily streaks may be appropriate for specific behaviors only when daily repetition truly serves the behavior.

---

# 56. No Catch-Up Debt

When user returns after inactivity:

Do not show:

- giant overdue list,
- failed streak,
- 16 red tasks.

Instead:

> **Welcome back. We start from today.**

The system should:

1. close old commitments as missed/historical,
2. preserve evidence,
3. evaluate active plans,
4. create one restart action,
5. schedule a plan review if needed.

---

# 57. Comeback Loop

Trigger:

- 3+ days of inactivity,
- multiple misses,
- substantial plan drift.

Experience:

### Screen 1

> **You're still on the Path.**

### Screen 2

> “No catching up. Which area feels most important to restart?”

Or use AI recommendation.

### Screen 3

Offer small action.

### Completion

> **Back on Path.**

Then schedule next realistic commitment.

---

# 58. Notification System Philosophy

Notifications are behavioral interventions.

They should be optimized for:

> **successful real-world action per interruption**

not:

> push open rate.

---

# 59. Notification Decision Engine

The decision to send should be deterministic initially.

Potential inputs:

- notification permission,
- quiet hours,
- daily cap,
- weekly cap,
- commitment importance,
- time proximity,
- prior completion,
- recent message count,
- dismissal history,
- user response history,
- current domain mode,
- lapse status.

---

# 60. Notification Categories

## N1 — Upcoming commitment

> Upper A starts in 20 minutes.

## N2 — Start cue

> Your proposal start is ready.

## N3 — Procrastination rescue

> This has moved twice. Give it ten minutes.

## N4 — Fallback offer

> Forty minutes won't fit. The 14-minute version will.

## N5 — Family presence cue

> Dinner starts soon. Phone-free for the first 30 minutes?

## N6 — Recovery

> No catching up. One useful action today is enough.

## N7 — Evidence celebration

> Third workout this week. This is becoming a pattern.

## N8 — Weekly review

> Your week is ready to review.

## N9 — Plan issue

> Two evening workouts failed. I think the schedule needs changing.

---

# 61. Notification Limits

Default constraints:

- maximum behavioral notifications/day,
- maximum non-critical reminders for same commitment,
- no repeated reminders after explicit skip,
- quiet hours,
- automatic reduction if ignored repeatedly.

Exact caps should be experiment-controlled.

---

# 62. Notification Personalization

Personalize:

- timing,
- tone,
- directness,
- length,
- domain emphasis,
- action label.

Do not generate manipulative guilt.

---

# 63. Notification Actions

Every notification should deep-link to action.

Examples:

`Start 10 min`

`Start workout`

`I'm in`

`Move`

`Use short version`

`Skip today`

---

# 64. Notification Learning

The system should learn:

- messages the user acts on,
- timing that works,
- categories ignored,
- whether reminders are becoming unnecessary.

Example insight:

> Workout reminders sent 30 minutes before start produce substantially more starts than reminders sent at start time.

This should feed experimentation.

---

# 65. Notification Independence Metric

Track:

> percentage of commitments completed before any reminder is required.

As behavior stabilizes, notification volume should decline.

---

# 66. Coach Screen

Chat exists, but should never be the only way to access AI.

Suggested prompts:

- Help me plan my week
- I'm procrastinating
- Make today's workout shorter
- I fell off
- Review my progress
- Help me decide what matters
- Change my plan

Conversation should be context-aware.

The user should not need to restate active goals.

---

# 67. Coach Response Style

Default response:

1. acknowledge relevant situation,
2. state observation,
3. recommend action,
4. offer direct CTA.

Avoid long motivational speeches.

Example:

> “You've moved this task three times, and the first step is still vague. Don't work on the whole proposal. Spend ten minutes writing the recommendation and three supporting points.”
>
> `Start 10 minutes`

---

# 68. User-Initiated Plan Changes

Natural language:

> “My schedule changed. I can't work out Wednesday anymore.”

AI:

1. queries active Health plan,
2. finds candidate slots,
3. proposes adjustment,
4. shows plan diff,
5. asks approval.

---

# 69. Calendar Integration — Later V1/V2

Calendar integration should eventually help identify:

- fixed commitments,
- available windows,
- conflicts,
- travel,
- work-heavy weeks.

Calendar events should not automatically be treated as sensitive semantic truth.

The application should minimize ingestion and storage.

---

# 70. Planning Guardrails

The AI should detect unrealistic plans.

Potential heuristic:

Maximum number of new recurring behaviors during first two weeks:

**3 major behavior commitments total**

Not per domain.

Additional small actions may exist, but onboarding should avoid overload.

---

# 71. Plan Difficulty

Each plan should have internal difficulty dimensions:

- time load,
- frequency,
- psychological friction,
- scheduling rigidity,
- novelty,
- user confidence.

If combined difficulty exceeds threshold, AI should reduce scope.

---

# 72. User Confidence

Before activating major plan:

> How confident are you that you can do this in a difficult week?

Scale:

1–5

If low:

AI should reduce plan.

A plan that only works during perfect weeks is not a good plan.

---

# 73. Daily Check-In

Check-in should be optional and brief.

Example:

> How does today feel?

- Normal
- Packed
- Low energy
- Unexpected problem

The response can alter suggested action size.

Avoid daily emotional interrogation.

---

# 74. End-of-Day Reflection

Optional.

> Anything EvolvePath should learn from today?

Quick options:

- Plan worked
- Too much
- Bad timing
- Unexpected conflict
- Low energy
- I avoided it
- Other

This creates structured friction data.

---

# 75. Progress Screen

Sections:

### Your evolution

High-level trajectory.

### Momentum

Work / Family / Health.

### Evidence

Meaningful completions.

### Consistency

Weekly trend.

### Recovery

Average days to return after miss.

### Coach dependency

Percent completed without reminder.

### Insights

Durable learned patterns.

---

# 76. Evidence Timeline

Chronological meaningful events.

Examples:

> Sep 3 — Started avoided proposal after two postponements.

> Sep 4 — Completed Upper A.

> Sep 6 — Protected family dinner.

> Sep 8 — Returned to Health plan after one missed workout.

The timeline should create confidence from evidence.

---

# 77. Celebrations

Celebrate:

- behavior,
- recovery,
- milestones,
- plan realism,
- increasing independence.

Examples:

> “Ten workouts completed.”

> “You returned the day after a miss.”

> “Four weeks of protecting Sunday family planning.”

> “You completed this week's focus blocks without a single reminder.”

Avoid constant confetti.

Celebration intensity should match significance.

---

# 78. Social / Accountability — Later

Potential:

- accountability partner,
- shared commitment,
- optional family ritual,
- encouragement.

Do not introduce public leaderboards for:

- body weight,
- family behavior,
- personal productivity.

---

# 79. Search and History

Users should be able to find:

- prior plans,
- workouts,
- outcomes,
- reflections,
- AI recommendations,
- plan changes.

The product should provide explainability:

> Why is this scheduled?

> Why did you recommend this?

---

# 80. Plan Versioning

Every plan should preserve history.

Example:

```text
Health Plan v1
3 workouts at 6 PM

Health Plan v2
2 weekday mornings + Saturday
Changed Sep 12
Reason: 3 repeated evening misses
```

---

# 81. Safety — Health

The application must avoid:

- diagnosis,
- medication changes,
- extreme exercise prescriptions,
- dangerous calorie restriction,
- encouragement of disordered eating,
- training through serious pain.

If user reports risk indicators, provide conservative guidance and encourage appropriate professional care.

---

# 82. Safety — Mental Health

EvolvePath is not psychotherapy.

The coach may use ordinary behavior-change language.

It should not claim:

- diagnosis,
- clinical treatment,
- mental health professional status.

High-risk crisis content should trigger safety protocols.

---

# 83. Safety — Family and Relationships

The coach should:

- focus on user's own actions,
- avoid diagnosing family members,
- avoid escalating conflict,
- not encourage surveillance,
- not encourage manipulation.

---

# 84. Safety — Work

Users may mention confidential business information.

The app should:

- discourage unnecessary sensitive detail,
- allow deletion,
- clearly explain data usage,
- avoid training-data ambiguity,
- support enterprise-grade privacy practices if commercialized.

---

# 85. AI Privacy

Users should be able to inspect:

- durable memories,
- active plans,
- inferred preferences.

Controls:

`Edit`

`Forget`

`Do not use for coaching`

---

# 86. Data Minimization

Do not store data simply because the model might find it useful someday.

Store data when it has a defined product purpose.

---

# 87. AI Context Boundary

Every AI call should receive the smallest sufficient context.

Example workout coaching does not need full family reflections.

Example family planning does not need detailed exercise logs unless cross-domain schedule reasoning requires summarized availability.

---

# 88. Observability

AI operations must be observable internally.

Log:

- model,
- prompt version,
- structured input,
- structured output,
- validation result,
- latency,
- token use,
- safety decision,
- user acceptance/rejection.

Do not log hidden chain-of-thought.

---

# 89. AI Evaluation

Offline evaluation suites should test:

### Planning quality

Does the AI create actionable plans?

### Overload prevention

Does it reduce unrealistic plans?

### Procrastination coaching

Does it identify the correct intervention?

### State fidelity

Does it reference actual plans correctly?

### Workout safety

Does it stay within safe boundaries?

### Family privacy

Does it avoid profiling loved ones?

### Tone

Does direct coaching remain respectful?

### Mutation safety

Does it avoid changing plans without approval?

---

# 90. AI Hallucination Tests

Test cases:

- nonexistent workout history,
- incorrect active plan,
- wrong family member,
- fabricated completion,
- invented schedule conflict.

Expected behavior:

The model must not fabricate.

---

# 91. Product Analytics Event Model

Examples:

- onboarding_started
- best_self_created
- outcome_created
- plan_created
- plan_approved
- commitment_created
- commitment_started
- commitment_completed
- commitment_rescheduled
- commitment_missed
- fallback_used
- workout_started
- workout_completed
- exercise_logged
- weekly_review_completed
- comeback_started
- comeback_completed
- notification_sent
- notification_opened
- notification_actioned
- notification_dismissed
- coach_intervention_delivered
- plan_change_recommended
- plan_change_accepted
- plan_change_rejected
- memory_insight_proposed
- memory_insight_accepted
- memory_insight_deleted

---

# 92. North Star Metric

Recommended North Star:

> **Weekly Meaningful Commitments Completed per Retained User**

A meaningful commitment is tied to an active user-selected Outcome or Routine.

This prevents gaming with trivial app actions.

---

# 93. Supporting Metrics

## Behavior

- planned vs completed,
- start rate,
- completion rate,
- fallback usage,
- reschedule rate,
- repeated reschedule rate.

## Recovery

- median days to return,
- comeback completion,
- miss-to-next-action latency.

## Planning

- plan acceptance,
- plan modification,
- plan adherence,
- plan difficulty.

## AI

- AI recommendation acceptance,
- plan-change acceptance,
- intervention usefulness rating,
- correction rate.

## Engagement

- D1,
- D7,
- D30,
- W4,
- W8 retention.

## Independence

- no-reminder completion rate,
- reminders required per commitment.

---

# 94. Domain Metrics

## Work

- high-priority starts,
- repeated postponement,
- focus sessions,
- meaningful outcomes completed.

## Family

- user-selected commitments kept,
- recurring rituals maintained.

## Health

- planned workouts completed,
- training consistency,
- progression,
- recovery after missed workouts.

---

# 95. Experimentation Platform

EvolvePath should be designed for continuous experimentation.

Experiment dimensions:

- onboarding sequence,
- number of initial commitments,
- notification timing,
- notification tone,
- reminder escalation,
- weekly vs daily streak model,
- comeback messaging,
- plan difficulty,
- AI coaching directness,
- fallback thresholds,
- weekly review timing,
- celebration intensity.

Every experiment must include behavior-quality guardrail metrics.

Example:

A notification experiment cannot be declared successful based only on app opens.

---

# 96. Notification Experiment Example

Hypothesis:

> A reminder 20 minutes before planned workout will increase workout starts more than a reminder at start time.

Primary metric:

> workout_started within 60 minutes.

Guardrails:

- notification opt-out,
- dismiss rate,
- total notification volume,
- D30 retention.

---

# 97. Procrastination Experiment Example

Hypothesis:

> After two reschedules, offering a 10-minute decomposed start will outperform another standard reminder.

Primary:

> commitment_started.

Secondary:

> meaningful work completed within 24h.

---

# 98. Research-Informed Duolingo Lessons

EvolvePath should adopt several product lessons demonstrated by Duolingo's experimentation.

### Separate continuity from intensity

A user should be able to preserve momentum through a small meaningful action even when the ideal plan cannot be completed.

### Make the next action obvious

The user should not need to decide what to do every time they open the application.

### Add flexibility

Grace and recovery can strengthen persistence.

### Personalize reminders

Different users respond to different timing and messaging.

### Test aggressively

Copy, timing, thresholds, plan size, and celebrations should be experimentally validated.

### Avoid notification spam

Long-term behavior matters more than short-term opens.

---

# 99. V1 Scope

V1 must prove one hypothesis:

> **Can an AI coach with persistent structured plans improve execution and recovery across Work, Family, and Health?**

V1 should include:

### Foundation

- account,
- onboarding,
- Best Self,
- three domains,
- outcomes,
- plans,
- commitments,
- evidence,
- plan versioning.

### Today

- next-best-action,
- domain cards,
- quick logging,
- start flow.

### AI

- planning,
- coaching,
- procrastination intervention,
- weekly review,
- plan adaptation proposals,
- structured memory.

### Work

- outcomes,
- planned focus blocks,
- task decomposition,
- start timer,
- rescheduling.

### Family

- commitments,
- rituals,
- schedule,
- completion.

### Health

- workout program creation,
- workout persistence,
- workout logging,
- exercise history,
- simple progression,
- fallback workouts.

### Momentum

- domain trends,
- evidence timeline,
- comeback flow.

### Notifications

- scheduled commitments,
- rescue,
- fallback,
- weekly review,
- recovery.

### Safety

- core health,
- eating,
- mental-health,
- family/privacy boundaries.

---

# 100. What V1 Must Not Include

Do not build initially:

- wearables,
- Oura,
- WHOOP,
- Garmin,
- Apple Health dependency,
- continuous glucose integrations,
- public social feed,
- public leaderboards,
- advanced calorie database,
- restaurant food database,
- full calendar replacement,
- email client,
- Slack client,
- enterprise task management,
- couples therapy,
- biometric recovery scoring,
- complex financial goals,
- marketplace of coaches,
- dozens of life domains,
- avatar economy,
- generic XP system.

These features distract from proving behavior change.

---

# 101. V1 Critical User Journey

## Day 0

User completes onboarding.

Creates:

Work:
> Start high-priority work before email three mornings this week.

Family:
> Phone-free dinner Tuesday, Thursday, Sunday.

Health:
> Three 35-minute strength workouts.

User approves plan.

## Day 1

Morning:

Notification:

> Your 20-minute proposal start is ready.

User starts.

Evidence recorded.

Evening:

Family commitment appears.

User confirms.

## Day 2

Workout scheduled.

User says:

> I only have 15 minutes.

AI checks active workout.

Offers minimum version.

User completes.

Evidence:

> fallback completed.

Momentum preserved.

## Day 3

Work action postponed twice.

AI:

> You have moved this twice. What's making it hard to start?

User:

> It feels too big.

AI decomposes task.

User starts 10 minutes.

## Day 7

Weekly review.

AI observes:

- morning Work successful,
- evening workout failed,
- family mostly successful.

Proposes:

> move evening workout to Saturday morning.

User approves.

Plan v2 created.

This is the core EvolvePath value loop.

---

# 102. V1 Acceptance Criteria — Onboarding

A new user can:

- define desired self,
- choose domains,
- create initial outcomes,
- receive AI plan,
- modify plan,
- approve plan,
- select coaching style,
- configure notifications,
- see Today screen.

The initial plan must persist after session ends.

---

# 103. V1 Acceptance Criteria — Plans

- Every active outcome has a persistent plan.
- Plans have versions.
- AI cannot silently modify plan.
- User can inspect why plan changed.
- Commitments derive from active plan.
- Old commitments remain historical evidence.

---

# 104. V1 Acceptance Criteria — Work

- User can create work outcome.
- AI can break outcome into planned sessions.
- User can start a focus action.
- User can reschedule.
- Repeated reschedules trigger friction intervention.
- Start is recorded separately from completion.

---

# 105. V1 Acceptance Criteria — Family

- User can create family commitment.
- User can create recurrence.
- Reminder deep-links to commitment.
- User can complete, move, or skip.
- Product never creates family-quality score.

---

# 106. V1 Acceptance Criteria — Health

- User can create workout program.
- Program persists.
- User can start workout.
- User can log sets/reps/load.
- History appears next session.
- Short/minimum workout available.
- AI can recommend plan adjustment.
- User approves structural changes.

---

# 107. V1 Acceptance Criteria — AI

AI responses must:

- reference correct active state,
- not invent completion,
- produce valid structured output,
- stay within safety boundaries,
- offer actionable next step,
- honor coaching preference,
- propose plan changes rather than silently executing them.

---

# 108. V1 Acceptance Criteria — Notifications

- notifications respect quiet hours,
- action deep-link works,
- user can move/skip from appropriate surfaces,
- ignored notifications are tracked,
- same commitment cannot generate uncontrolled repeated messages,
- comeback notification does not use shame.

---

# 109. V1 Acceptance Criteria — Recovery

After multiple missed days:

- overdue items do not flood Today,
- user gets restart experience,
- prior misses remain evidence,
- one next action is recommended,
- plan review becomes available.

---

# 110. Functional Requirement Priority

Use:

- P0 — required for V1
- P1 — important after launch
- P2 — later

---

# 111. P0 Requirements

### P0-1
Persistent Best Self.

### P0-2
Persistent domain outcomes.

### P0-3
Versioned plans.

### P0-4
Commitments and evidence.

### P0-5
Today screen.

### P0-6
Next-best-action.

### P0-7
AI planning.

### P0-8
AI coaching.

### P0-9
Procrastination intervention.

### P0-10
Weekly review.

### P0-11
Comeback flow.

### P0-12
Workout program and logging.

### P0-13
Notification system.

### P0-14
Momentum.

### P0-15
AI safety layer.

---

# 112. P1 Requirements

- calendar integration,
- widgets,
- optional meal planning,
- enhanced progress visualization,
- voice coach,
- accountability partner,
- richer memory controls,
- program templates,
- travel mode,
- family event planning.

---

# 113. P2 Requirements

- optional wearables,
- advanced nutrition,
- richer social features,
- external coach sharing,
- advanced adaptive notification learning,
- additional domains.

---

# 114. Technical Architecture — Product-Level

Suggested logical architecture:

```text
Mobile/Web Client
      |
API Gateway
      |
------------------------------------------------
| Identity Service                             |
| User/Profile Service                         |
| Goal & Plan Service                          |
| Commitment Service                           |
| Workout Service                              |
| Evidence/Event Service                       |
| Notification Service                         |
| Memory Service                               |
| Analytics/Event Pipeline                     |
------------------------------------------------
      |
AI Orchestration Layer
      |
------------------------------------------------
| Context Builder                              |
| Planner                                      |
| Coach                                        |
| Weekly Reviewer                              |
| Workout Reasoner                             |
| Pattern Analyzer                             |
| Notification Copy Generator                  |
| Safety Policy                                |
------------------------------------------------
      |
LLM Provider(s)
```

Start as modular monolith if appropriate.

Do not prematurely create many microservices.

The logical boundaries matter more than physical deployment boundaries.

---

# 115. Recommended AI Orchestration Pattern

Every AI workflow:

1. Identify intent.
2. Retrieve authoritative state.
3. Build scoped context.
4. Apply policy.
5. Call model with structured contract.
6. Validate output.
7. Apply deterministic business rules.
8. Show proposal/action.
9. Persist only approved or valid changes.
10. Log outcome for evaluation.

---

# 116. Retrieval Strategy

Do not dump the entire user history into the prompt.

Retrieve:

- active objects,
- relevant recent events,
- relevant memories,
- domain-specific history.

Example:

Workout request needs:

- program,
- recent sessions,
- exercise history,
- time availability,
- relevant limitations.

It does not need:

- full Work task history.

---

# 117. AI Prompt Governance

Prompts should be versioned.

Each prompt should specify:

- role,
- objective,
- authoritative data,
- prohibited assumptions,
- output schema,
- coaching tone,
- safety instructions.

Prompt version must be captured in logs.

---

# 118. AI Cost Strategy

Use model tiering.

Potential:

### Smaller model

- intent classification,
- extraction,
- notification rewrite,
- simple summaries.

### Strong reasoning model

- onboarding plan,
- weekly review,
- complex plan adaptation,
- cross-domain trade-offs.

Cache stable summaries.

Do not repeatedly summarize unchanged state.

---

# 119. Latency Targets

User-facing quick interactions:

Target perceived response:

< 2–3 seconds where practical.

Longer reasoning flows should use progressive UI.

Never block basic deterministic functions on AI.

Example:

Workout logging must work even if AI unavailable.

---

# 120. AI Failure Degradation

If AI unavailable:

Today screen still works.

User can:

- start planned commitment,
- complete commitment,
- log workout,
- reschedule,
- view plan.

AI enhancement can return later.

The plan cannot be load-bearing on model availability.

---

# 121. Offline Considerations

Workout logging should support intermittent connectivity.

Queue events.

Sync when online.

---

# 122. Accessibility

Requirements:

- screen reader support,
- scalable text,
- high contrast,
- large touch targets,
- not color-only status,
- captions/transcripts for future voice,
- reduced motion.

---

# 123. Mobile-First

Primary platform should be mobile because behavior intervention often occurs near the moment of action.

Web is useful for:

- deeper review,
- planning,
- account management.

The daily action loop should be excellent on mobile.

---

# 124. Home Screen Widget — P1

Widget could show:

> Next meaningful action.

Example:

> Upper A · 6:30 PM

Or:

> Proposal start · 20 min

The widget should enable action, not become decorative.

---

# 125. Voice — P1

Voice is particularly useful during:

- workouts,
- walking,
- weekly reflection,
- commute planning.

Voice and text should access the same product state.

Voice must not be a separate memory universe.

---

# 126. Error Handling

If AI proposal cannot be validated:

- do not persist,
- explain a safe fallback,
- allow retry.

Example:

> “I couldn't create a valid workout change. Your current plan is unchanged.”

---

# 127. User Control

User can:

- pause a domain,
- archive goal,
- edit commitment,
- mute category,
- change coaching style,
- delete memory,
- delete data,
- override recommendation.

The AI is a coach, not authority.

---

# 128. Explainability

For any important recommendation:

`Why this?`

Example:

> “I recommended Saturday because you completed 3 of your last 4 Saturday workouts and missed 3 of 4 Wednesday evening workouts.”

Evidence should be understandable.

---

# 129. Anti-Manipulation Requirements

Never:

- imply disappointment,
- threaten user,
- guilt user about loved ones,
- frame notification opt-out as moral failure,
- create fake urgency,
- imply the AI is emotionally harmed when ignored.

---

# 130. Monetization Considerations

Not required for V1 product validation.

Potential model:

Free:

- limited active Path,
- basic tracking,
- basic coaching.

Premium:

- full AI coaching,
- more active outcomes,
- advanced workouts,
- advanced reviews,
- deeper personalization.

Monetization must not turn recovery mechanisms into punitive paywalls.

---

# 131. Product Positioning

Recommended positioning:

> **EvolvePath is an AI personal growth coach for people who know what they want to improve but struggle to stay consistent. It turns goals into realistic plans, helps you act across work, family, and health, adapts when life gets in the way, and helps you build lasting momentum.**

---

# 132. Differentiation

EvolvePath differentiates through:

### Persistent plans

Not disposable chats.

### Cross-domain intelligence

One life, not independent optimizers.

### Anti-procrastination focus

Starting is a feature.

### Recovery

Failure is handled explicitly.

### Workout execution

Health is not motivational advice; it includes real persistent programs.

### Adaptive notifications

Notifications are coaching interventions.

### Structured AI memory

The coach learns from behavior.

### Reduced dependency as success

The app wants the user to become more capable.

---

# 133. Product Loop

The primary product loop is:

```text
Choose what matters
      ↓
Create realistic plan
      ↓
See today's next action
      ↓
Act
      ↓
Record evidence
      ↓
AI learns
      ↓
Plan adapts
      ↓
Momentum increases
```

---

# 134. Daily Loop

```text
Open
 ↓
Understand
 ↓
Start
 ↓
Complete or fallback
 ↓
Evidence
 ↓
Leave
```

---

# 135. Weekly Loop

```text
Review plan
 ↓
Compare planned vs done
 ↓
Identify friction
 ↓
Learn pattern
 ↓
Adjust plan
 ↓
Approve next week
```

---

# 136. Comeback Loop

```text
Miss
 ↓
Slip
 ↓
No shame
 ↓
Reduce scope
 ↓
Restart
 ↓
Record recovery
 ↓
Rebuild consistency
```

---

# 137. AI Learning Loop

```text
Recommendation
 ↓
User action
 ↓
Outcome
 ↓
Feedback
 ↓
Pattern update
 ↓
Future recommendation improves
```

---

# 138. Core UX Emotional States

EvolvePath should create:

### After onboarding

> “This feels realistic.”

### During the first week

> “This app remembers what I am trying to do.”

### During procrastination

> “It helped me start.”

### After a missed week

> “I can recover.”

### After a month

> “There is evidence I am changing.”

### After several months

> “I don't need as much help as I used to.”

---

# 139. Research Foundation

EvolvePath's product strategy is informed by research and product evidence around:

- the intention-behavior gap,
- implementation intentions,
- behavior change techniques,
- procrastination treatment,
- just-in-time adaptive interventions,
- autonomy-supportive motivation,
- self-monitoring,
- prompts and cues,
- behavioral feedback,
- graded tasks,
- flexible continuity,
- adaptive reminders.

Important caveat:

No behavioral framework guarantees individual behavior change.

EvolvePath should treat these as evidence-informed tools to test rigorously inside the product.

---

# 140. Research Notes for Product Team

### Implementation intentions

Specific if-then/action plans have demonstrated useful effects across multiple behavior domains, including healthy eating and physical activity.

Product implication:

> Plans should connect action with context rather than remain abstract.

### Procrastination

Psychological interventions show modest overall effects, with CBT-oriented approaches demonstrating stronger effects in some analyses.

Product implication:

> Procrastination requires active intervention, especially decomposition, friction identification, behavioral activation, and cognition-aware coaching.

EvolvePath is not providing clinical CBT; it may borrow non-clinical behavior principles such as breaking avoidance loops and testing smaller actions.

### JITAI

Just-in-time adaptive intervention research supports the logic of delivering contextually relevant interventions near moments of need, while also showing that timing, engagement, and over-intervention remain difficult problems.

Product implication:

> Build notification and intervention decisions as an adaptive system and test them empirically.

### Duolingo

Duolingo's public experimentation has shown the value of:

- small daily minimums,
- separating intensity from continuity,
- streak flexibility,
- personalized reminders,
- extensive A/B testing,
- long-term habit building instead of notification spam.

Product implication:

> Protect continuity without making perfection the goal.

---

# 141. Key Research References

The product team should maintain a separate research repository, but foundational sources include:

1. Michie S. et al. Behavior Change Technique Taxonomy v1: 93 behavior change techniques. *Annals of Behavioral Medicine*, 2013. PMID 23512568.
2. Webb TL, Sheeran P. Does changing behavioral intentions engender behavior change? *Psychological Bulletin*, 2006. PMID 16536643.
3. Adriaanse MA et al. Implementation intentions and healthy eating. *Appetite*, 2011. PMID 21056605.
4. Carrero I. et al. Implementation intentions for healthy eating: meta-regression. *Appetite*, 2019. PMID 31125588.
5. Rozental A. et al. Psychological treatments for procrastination: systematic review and meta-analysis. *Frontiers in Psychology*, 2018.
6. Nahum-Shani I. et al. Just-in-Time Adaptive Interventions in Mobile Health: key components and design principles. *Annals of Behavioral Medicine*, 2018.
7. Nahum-Shani I., Murphy SA. Just-In-Time Adaptive Interventions: Where Are We Now and What Is Next? *Annual Review of Psychology*, 2026.
8. Duolingo public product and engineering posts on streak design, notification personalization, copy experimentation, product principles, and streak flexibility.

---

# 142. Open Product Questions

These require experimentation rather than opinion.

### Q1
Should EvolvePath show one global Momentum state or only domain states?

Recommendation:

Start with domain states and a qualitative overall summary.

### Q2
Should users have a visible streak?

Recommendation:

Test weekly consistency first.

### Q3
How direct should AI be by default?

Recommendation:

Balanced default, user selectable.

### Q4
How much data should weekly review require from user?

Recommendation:

Near-zero required reflection; rely on behavior data and ask one high-value question.

### Q5
Should Family be enabled by default?

Recommendation:

Yes in positioning, optional during onboarding.

### Q6
Should calorie tracking exist?

Recommendation:

Not in initial V1.

### Q7
How often should AI propose plan changes?

Recommendation:

Only when confidence threshold or user request justifies it.

---

# 143. Product Risks

## Risk: Scope explosion

Three domains can become three products.

Mitigation:

Only build domain capabilities directly required by the shared behavior-change loop.

## Risk: AI becomes generic chat

Mitigation:

Make Today, Plan, Evidence, and Commitments primary.

## Risk: User over-plans

Mitigation:

Enforce plan difficulty and new-behavior limits.

## Risk: Notification fatigue

Mitigation:

Caps, personalization, reduction, experimentation.

## Risk: Shame

Mitigation:

Recovery-first language and no brittle global streak.

## Risk: Health liability

Mitigation:

Conservative scope and safety rules.

## Risk: AI hallucination

Mitigation:

structured state, constrained outputs, validation, plan ownership.

## Risk: User abandonment

Mitigation:

small initial plan, quick action, comeback system.

---

# 144. Definition of Product Success

EvolvePath is succeeding when a user can say:

> “I used to keep saying I would do these things. Now I actually do them more often.”

Not:

> “I spend a lot of time talking to the AI.”

Not:

> “I have a 500-day app-opening streak.”

Not:

> “My dashboard has many metrics.”

The product wins when behavior changes.

---

# 145. Final Product Requirement

Every meaningful EvolvePath feature must participate in at least one of these functions:

1. **Clarify** what matters.
2. **Plan** realistic behavior.
3. **Start** action.
4. **Execute** the plan.
5. **Record** evidence.
6. **Learn** from behavior.
7. **Adapt** the plan.
8. **Recover** after failure.
9. **Strengthen** future independence.

If a proposed feature cannot clearly explain which function it serves, it should not be built.

---

# 146. Final Statement

EvolvePath should become the personal AI coach for people who are serious about improving but tired of relying on motivation.

It should help users transform intention into action across Work, Family, and Health.

It should know the plan.

It should remember what happened.

It should help when the user is stuck.

It should notice when the plan is unrealistic.

It should provide the right intervention at the right moment.

It should help the user recover without erasing responsibility.

It should create visible evidence of change.

And ultimately, it should help the user need less help.

> **The goal is not to make people better at using EvolvePath.**

> **The goal is to help people become better at living the life they said they wanted.**
