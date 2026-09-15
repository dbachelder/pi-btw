---
name: btw
description: Helps you use the /btw side-conversation workflow effectively. Use when you want to think in parallel, ask side questions without interrupting ongoing work, or inject a side thread back into the main agent.
---

# BTW

Use this skill when the user wants to work in parallel with the main agent instead of derailing the current turn.

## When to use BTW

Prefer the BTW workflow when the user wants to:

- ask a side question while the main agent keeps working
- brainstorm or compare options without interrupting the current run
- prepare a plan or summary before handing it back to the main agent
- keep exploratory discussion out of the main transcript/context

## Commands

Use these commands in your guidance to the user:

```text
/btw [--model <m>] [--thinking <t>] [--save] <question>
/btw:new [--model <m>] [--thinking <t>] [--save] [question]
/btw:tangent [--model <m>] [--thinking <t>] [--save] <question>
/btw:debug [on | off | <question>]
/btw:copy
/btw:sync
/btw:clear
/btw:thinking [<level> | clear]
/btw:inject [instructions]
/btw:summarize [instructions]
```

## How to guide the user

### For a quick side question

Recommend:

```text
/btw <question>
```

Use this when the user wants an immediate aside and does not need a visible saved note.

### For a saved one-off note

Recommend:

```text
/btw --save <question>
```

Use this when the user wants the exchange to appear as a visible BTW note in the session transcript.

### For a fresh side thread

Recommend:

```text
/btw:new
```

or

```text
/btw:new <question>
```

Use this when the previous BTW discussion is no longer relevant, but you still want the new side thread to inherit the current main-session context.

### For a contextless tangent thread

Recommend:

```text
/btw:tangent <question>
```

or

```text
/btw:tangent --save <question>
```

Use this when the user wants a side conversation that does not include the current main-session context.

### To refresh parent context into an active BTW thread

Recommend:

```text
/btw:sync
```

(or type `/sync` directly into the BTW modal composer).

### To copy the last BTW response to clipboard

Recommend:

```text
/btw:copy
```

(or type `/copy` directly into the BTW modal composer).

Recommend:

```text
/btw:inject <instructions>
```

Use this when the exact discussion matters and the user wants the main agent to act on it.

### To hand back a condensed version

Recommend:

```text
/btw:summarize <instructions>
```

Use this when the thread is long and only the distilled outcome should go back into the main agent.

### To make BTW cheaper or faster than the main thread

Recommend:

```text
/btw --model <name> --thinking <level> <question>
```

Or adjust it directly inside the BTW popup window using natural language:

```text
"switch to gpt-5-mini with low thinking"
```

Use these when the main thread should keep its current model or thinking level,
but BTW should run with a different cost/speed profile. Model queries support
fuzzy search and provider aliases (e.g. `copilot/gpt-5.4`, `gpt-5-mini`,
`claude`). If a query is ambiguous across authenticated providers, the popup
prompts you to pick one.

### To view thinking and tool executions

Recommend:

```text
/btw:debug <question>
```

or

```text
/btw:debug on
```

Use this when you need visibility into model thinking and tool execution
details. Subsequent `/btw` invocations automatically switch debug mode back off.

## Recommendation rules

- Prefer `/btw` over normal chat when the user explicitly wants a side conversation.
- Prefer `/btw:tangent` when the user wants that side conversation to be contextless.
- Prefer `/btw:summarize` over `/btw:inject` for long exploratory threads.
- Prefer `/btw:inject` when precise wording, detailed tradeoffs, or a full plan matters.
- Suggest `/btw:new` before starting a totally unrelated side topic when main-session context is still useful.
- Suggest `/btw:clear` when the widget/thread should be dismissed.
- Suggest `--model` or `--thinking` flags (or natural language in the popup) when the user wants BTW to be cheaper, faster, or less deliberative than the main thread.

## Response style

When helping the user use BTW:

- give the exact slash command to run
- explain briefly why that command fits
- keep the guidance short and operational

## Examples

### Example: brainstorm while coding continues

```text
/btw what are the risks of switching this to optimistic updates?
```

### Example: create a clean new thread

```text
/btw:new sketch a safer migration plan
```

### Example: start a contextless tangent

```text
/btw:tangent think through this from first principles without using the current chat context
```

### Example: send the result back

```text
/btw:summarize implement the recommended migration plan
```

### Example: make BTW cheaper than the main thread

```text
/btw --model gpt-5-mini --thinking low what are the risks of this change?
```
