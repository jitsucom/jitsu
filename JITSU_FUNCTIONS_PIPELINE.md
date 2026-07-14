# Jitsu Functions Pipeline

## Overview

Jitsu provides a powerful event processing pipeline that allows you to filter, transform, and enrich events before sending them to destinations.

## Pipeline Architecture

The event processing pipeline consists of **3 main steps** executed sequentially:

<svg width="700" height="500" viewBox="0 0 700 500" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <!-- Background -->
  <rect width="700" height="500" fill="#f8f9fa"/>

  <!-- Title -->
  <text x="330" y="30" font-family="Arial, sans-serif" font-size="20" font-weight="bold" text-anchor="middle" fill="#1f2937" dominant-baseline="middle">Jitsu Event Processing Pipeline</text>

  <!-- Incoming Event -->
  <circle cx="100" cy="100" r="30" fill="#3b82f6" stroke="#1e40af" stroke-width="2"/>
  <text x="100" y="100" font-family="Arial, sans-serif" font-size="12" font-weight="bold" text-anchor="middle" fill="white" dominant-baseline="middle">Event</text>

  <!-- Arrow to Step 1 -->
  <line x1="130" y1="100" x2="180" y2="100" stroke="#374151" stroke-width="2" marker-end="url(#arrowhead)"/>

  <!-- Step 1: Builtin Transformation -->
  <rect x="180" y="60" width="300" height="80" rx="8" fill="#fef3c7" stroke="#f59e0b" stroke-width="2"/>
  <text x="330" y="90" font-family="Arial, sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="#92400e" dominant-baseline="middle">Step 1: Builtin Transformation</text>
  <text x="330" y="115" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#78350f" dominant-baseline="middle">Identity Stitching</text>

  <!-- Arrow to Step 2 -->
  <line x1="330" y1="140" x2="330" y2="190" stroke="#374151" stroke-width="2" marker-end="url(#arrowhead)"/>

  <!-- Step 2: User Defined Functions -->
  <rect x="180" y="190" width="300" height="140" rx="8" fill="#dbeafe" stroke="#3b82f6" stroke-width="2"/>
  <text x="330" y="215" font-family="Arial, sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="#1e3a8a" dominant-baseline="middle">Step 2: User Defined Functions</text>
  <text x="330" y="238" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#1e40af" dominant-baseline="middle">Sequential Execution</text>

  <!-- UDF Pipeline boxes -->
  <rect x="210" y="255" width="70" height="30" rx="4" fill="#3b82f6" stroke="#1e40af" stroke-width="1"/>
  <text x="245" y="270" font-family="Arial, sans-serif" font-size="10" text-anchor="middle" fill="white" dominant-baseline="middle">UDF 1</text>

  <line x1="280" y1="270" x2="295" y2="270" stroke="#1e3a8a" stroke-width="1" marker-end="url(#arrowhead-small)"/>

  <rect x="295" y="255" width="70" height="30" rx="4" fill="#3b82f6" stroke="#1e40af" stroke-width="1"/>
  <text x="330" y="270" font-family="Arial, sans-serif" font-size="10" text-anchor="middle" fill="white" dominant-baseline="middle">UDF 2</text>

  <line x1="365" y1="270" x2="380" y2="270" stroke="#1e3a8a" stroke-width="1" marker-end="url(#arrowhead-small)"/>

  <rect x="380" y="255" width="70" height="30" rx="4" fill="#3b82f6" stroke="#1e40af" stroke-width="1"/>
  <text x="415" y="270" font-family="Arial, sans-serif" font-size="10" text-anchor="middle" fill="white" dominant-baseline="middle">UDF N</text>

  <text x="330" y="310" font-family="Arial, sans-serif" font-size="10" font-style="italic" text-anchor="middle" fill="#1e40af" dominant-baseline="middle">Filter, Transform, Enrich</text>

  <!-- Arrow to Step 3 -->
  <line x1="330" y1="330" x2="330" y2="380" stroke="#374151" stroke-width="2" marker-end="url(#arrowhead)"/>

  <!-- Step 3: Builtin Destination -->
  <rect x="180" y="380" width="300" height="80" rx="8" fill="#fef3c7" stroke="#f59e0b" stroke-width="2"/>
  <text x="330" y="410" font-family="Arial, sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="#92400e" dominant-baseline="middle">Step 3: Builtin Destination</text>
  <text x="330" y="435" font-family="Arial, sans-serif" font-size="11" text-anchor="middle" fill="#78350f" dominant-baseline="middle">BiqQuery, ClickHouse, Mixpanel, Amplitude, etc.</text>

  <!-- Final Arrow to Destination -->
  <line x1="480" y1="420" x2="520" y2="420" stroke="#374151" stroke-width="2" marker-end="url(#arrowhead)"/>

  <!-- Destination Icon -->
  <rect x="520" y="390" width="80" height="60" rx="6" fill="#10b981" stroke="#059669" stroke-width="2"/>
  <text x="560" y="415" font-family="Arial, sans-serif" font-size="12" font-weight="bold" text-anchor="middle" fill="white" dominant-baseline="middle">Destination</text>
  <text x="560" y="433" font-family="Arial, sans-serif" font-size="10" text-anchor="middle" fill="white" dominant-baseline="middle">(DB/API)</text>

  <!-- Arrow markers -->
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <polygon points="0 0, 10 3, 0 6" fill="#374151"/>
    </marker>
    <marker id="arrowhead-small" markerWidth="8" markerHeight="8" refX="7" refY="2.5" orient="auto">
      <polygon points="0 0, 8 2.5, 0 5" fill="#1e3a8a"/>
    </marker>
  </defs>
</svg>

### Step 1: Builtin Transformations
These are system-level functions like Identity Stitching that run before user functions. Currently includes:
- **Identity Stitching**: Recognizes and merges user identities across sessions

### Step 2: User Defined Function Pipeline
Your custom JavaScript functions that can:
- Filter events (exclude unwanted data)
- Transform events (modify structure/fields)
- Enrich events (add external data)

Multiple UDFs are executed **sequentially** in the order defined.

### Step 3: Builtin Destination Function

The final function that sends the processed event to the configured destination (e.g. Mixpanel, Amplitude, Webhook, etc.)

All data warehouse destinations uses the same bridge function that passes event payload to the bulker component.

Since they are functions as any other user defined functions, they report logs and errors in the similar way.
You can check logs and errors of functions attached to certain connection in the Data - Live Events section of the Workspace.

## Error Handling in Builtin Functions

Builtin transformation and destination functions follow strict error handling:

### Any Standard Error

- Error is **logged** to destination log
- Event is sent to **dead-letter storage** (viewable in UI Live Events section)

### RetryError

```javascript
throw new RetryError("Temporary failure");
```
- Error is **logged** to destination log
- Event is sent to **retry queue**. After retry, processing resumes from the failed step with payload changes retained.

## Error Handling in User Defined Functions

User-defined functions have **more flexible error handling** to support partial enrichment and graceful degradation:

### Any Standard Error
```javascript
throw new Error("Enrichment API failed");
```
- Error is **logged** to destination log
- Event **continues to next function** in pipeline
- Processing is **NOT stopped**
- Use case: Allows non-enriched events to reach destination

### RetryError (default)
```javascript
throw new RetryError("Temporary enrichment failure");
```
- Error is **logged** to destination log
- Event goes to **retry queue** (will be retried later)
- Event **continues to next function** in pipeline
- Use case: Enrichment that can be retried later, allows partial data now, full data after retry

### RetryError with drop option
```javascript
throw new RetryError("Critical enrichment failed", { drop: true });
```
- Error is **logged** to destination log
- Event goes to **retry queue** (will be retried later)
- Pipeline **STOPS** immediately
- Event does **NOT** reach destination
- Use case: When partial/unenriched data should not be stored

### NoRetryError
```javascript
throw new NoRetryError("Invalid data format");
```
- Error is **logged** to destination log
- Event goes to **dead-letter storage**
- Pipeline **STOPS** immediately
- Event does **NOT** reach destination
- No retries
- Use case: Permanent errors that won't be fixed by retrying

### Error Handling Summary Table

| Error Type        | Location         | Retry Queue | Dead Letter | Continue Pipeline | Use Case                                 |
|-------------------|------------------|-------------|-------------|-------------------|------------------------------------------|
| Standard Error    | Builtin Function | ❌           | ✅           | ❌                 | Permanent builtin failure                |
| RetryError        | Builtin Function | ✅           | ❌           | ❌ (after retry)   | Temporary builtin failure                |
| Standard Error    | User Function    | ❌           | ❌           | ✅                 | Non-critical UDF failure                 |
| RetryError        | User Function    | ✅           | ❌           | ✅                 | Retriable enrichment, allow partial data |
| RetryError (drop) | User Function    | ✅           | ❌           | ❌                 | Retriable enrichment, no partial data    |
| NoRetryError      | User Function    | ❌           | ✅           | ❌                 | Permanent data issue                     |


## Retry Attempts and Delay

### Default Retry Policy

When a function throws a `RetryError`, Jitsu implements automatic retry logic with the following defaults:

- **Retry attempts**: 3 attempts maximum
- **Delays between attempts**: 10 minutes, 100 minutes, and 1000 minutes (16.7 hours)
- **Maximum delay**: 1440 minutes (24 hours) - any delay exceeding this will be capped

**Important**: When all retry attempts are exhausted, the event is sent to **dead-letter storage** where it can be viewed in the Live Events section of the UI.

### Custom Retry Policy Configuration

You can override the default retry policy by adding a configuration block to your function code:

```javascript
export const config = {
  retryPolicy: {
    attempts: 2,        // Number of retry attempts (max 3)
    delays: [60, 1440]  // Delays in minutes before each attempt (max 1440 per delay)
  }
}

export default async function(event, ctx) {
  // Your function logic here
}
```

#### Configuration Constraints

- **`attempts`**: Cannot exceed 3 (system limit)
- **`delays`**:
  - Individual delays cannot exceed 1440 minutes (24 hours)
  - Array length must match the `attempts` count
  - Delays are specified in minutes

### How Retries Work

1. **First Failure**: When a function throws `RetryError`, the event is sent to the retry queue
2. **Scheduled Retry**: The event is scheduled for retry after the delay specified in `delays[0]`
3. **Subsequent Failures**: If the function fails again, the event is retried after `delays[1]`, then `delays[2]`, etc.
4. **Exhausted Attempts**: After all retry attempts are exhausted, the event is moved to **dead-letter storage**
5. **Success**: If any retry succeeds, the event continues through the pipeline normally


### Retry Behavior with Pipeline Execution

- **Retried events skip already processed steps**: When an event is retried, it resumes from the failed pipeline step, not from the beginning
- **Payload changes are retained**: Any modifications made in previous successful steps are preserved
- **User Defined Function Pipeline** considered as a single step: If a function in the UDF pipeline fails and event is retried, the entire UDF pipeline is re-executed
- **Pipeline continuation**:
    - With `RetryError` (no drop): Event continues to next function while also being queued for retry
    - With `RetryError({ drop: true })`: Event is queued for retry but does NOT continue to next function


### Retry Mechanism Flow Diagram

<svg width="950" height="650" viewBox="0 0 950 650" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <!-- Background -->
  <rect width="950" height="650" fill="#f8f9fa"/>

  <!-- Title -->
  <text x="425" y="30" font-family="Arial, sans-serif" font-size="18" font-weight="bold" text-anchor="middle" fill="#1f2937" dominant-baseline="middle">Retry Mechanism Flow</text>

  <!-- Initial Event -->
  <circle cx="100" cy="100" r="30" fill="#3b82f6" stroke="#1e40af" stroke-width="2"/>
  <text x="100" y="100" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="white" dominant-baseline="middle">Event</text>

  <!-- Step 1 -->
  <line x1="130" y1="100" x2="180" y2="100" stroke="#374151" stroke-width="2" marker-end="url(#arr)"/>
  <rect x="180" y="75" width="100" height="50" rx="6" fill="#fef3c7" stroke="#f59e0b" stroke-width="2"/>
  <text x="230" y="100" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#92400e" dominant-baseline="middle">Step 1</text>

  <!-- Step 1 Success -->
  <line x1="280" y1="100" x2="330" y2="100" stroke="#10b981" stroke-width="2" marker-end="url(#arr-green)"/>
  <text x="305" y="88" font-family="Arial, sans-serif" font-size="9" fill="#059669" dominant-baseline="middle">✓</text>

  <!-- Step 2 UDF -->
  <rect x="330" y="75" width="100" height="50" rx="6" fill="#dbeafe" stroke="#3b82f6" stroke-width="2"/>
  <text x="380" y="100" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#1e3a8a" dominant-baseline="middle">Step 2</text>

  <!-- Step 2 Fails -->
  <line x1="380" y1="125" x2="380" y2="170" stroke="#ef4444" stroke-width="2" marker-end="url(#arr-red)"/>
  <text x="400" y="150" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="#dc2626" dominant-baseline="middle">RetryError</text>

  <!-- Retry Queue -->
  <rect x="320" y="170" width="120" height="50" rx="6" fill="#fbbf24" stroke="#f59e0b" stroke-width="2"/>
  <text x="380" y="190" font-family="Arial, sans-serif" font-size="12" font-weight="bold" text-anchor="middle" fill="#78350f" dominant-baseline="middle">Retry Queue</text>
  <text x="380" y="207" font-family="Arial, sans-serif" font-size="9" text-anchor="middle" fill="#92400e" dominant-baseline="middle">Retry Count: 0</text>

  <!-- Wait for delay[0] -->
  <line x1="380" y1="220" x2="380" y2="270" stroke="#9ca3af" stroke-width="2" stroke-dasharray="4,4"/>
  <text x="420" y="250" font-family="Arial, sans-serif" font-size="10" fill="#6b7280" dominant-baseline="middle">Wait delays[0]</text>
  <text x="420" y="265" font-family="Arial, sans-serif" font-size="9" fill="#6b7280" dominant-baseline="middle">(10 min)</text>

  <!-- Retry 1 - Skip Step 1 -->
  <rect x="320" y="270" width="120" height="50" rx="6" fill="#fef3c7" stroke="#f59e0b" stroke-width="2"/>
  <text x="380" y="288" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#92400e" dominant-baseline="middle">Retry Attempt 1</text>
  <text x="380" y="305" font-family="Arial, sans-serif" font-size="9" text-anchor="middle" fill="#78350f" dominant-baseline="middle">Skip Step 1 ✓</text>

  <!-- Retry 1 runs Step 2 -->
  <line x1="440" y1="295" x2="490" y2="295" stroke="#374151" stroke-width="2" marker-end="url(#arr)"/>
  <rect x="490" y="270" width="100" height="50" rx="6" fill="#dbeafe" stroke="#3b82f6" stroke-width="2"/>
  <text x="540" y="295" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#1e3a8a" dominant-baseline="middle">Step 2</text>

  <!-- Retry 1 Fails -->
  <line x1="540" y1="320" x2="540" y2="370" stroke="#ef4444" stroke-width="2" marker-end="url(#arr-red)"/>
  <text x="560" y="348" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="#dc2626" dominant-baseline="middle">RetryError</text>

  <!-- Retry Queue 2 -->
  <rect x="480" y="370" width="120" height="50" rx="6" fill="#fbbf24" stroke="#f59e0b" stroke-width="2"/>
  <text x="540" y="390" font-family="Arial, sans-serif" font-size="12" font-weight="bold" text-anchor="middle" fill="#78350f" dominant-baseline="middle">Retry Queue</text>
  <text x="540" y="407" font-family="Arial, sans-serif" font-size="9" text-anchor="middle" fill="#92400e" dominant-baseline="middle">Retry Count: 1</text>

  <!-- Dots indicating more retries -->
  <text x="540" y="447" font-family="Arial, sans-serif" font-size="20" font-weight="bold" text-anchor="middle" fill="#9ca3af" dominant-baseline="middle">⋮</text>

  <!-- Retry 3 -->
  <rect x="480" y="470" width="120" height="50" rx="6" fill="#fef3c7" stroke="#f59e0b" stroke-width="2"/>
  <text x="540" y="488" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#92400e" dominant-baseline="middle">Retry Attempt 3</text>
  <text x="540" y="505" font-family="Arial, sans-serif" font-size="9" text-anchor="middle" fill="#78350f" dominant-baseline="middle">Skip Step 1 ✓</text>

  <!-- Retry 3 runs Step 2 -->
  <line x1="600" y1="495" x2="650" y2="495" stroke="#374151" stroke-width="2" marker-end="url(#arr)"/>
  <rect x="650" y="470" width="100" height="50" rx="6" fill="#dbeafe" stroke="#3b82f6" stroke-width="2"/>
  <text x="700" y="495" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#1e3a8a" dominant-baseline="middle">Step 2</text>

  <!-- Success Branch (Right) -->
  <line x1="750" y1="495" x2="800" y2="495" stroke="#10b981" stroke-width="2" marker-end="url(#arr-green)"/>
  <text x="775" y="485" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="#059669" dominant-baseline="middle">✓</text>

  <rect x="800" y="470" width="120" height="50" rx="6" fill="#d1fae5" stroke="#10b981" stroke-width="2"/>
  <text x="860" y="488" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#065f46" dominant-baseline="middle">Continue to</text>
  <text x="860" y="505" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#065f46" dominant-baseline="middle">Step 3</text>

  <!-- Failure Branch (Bottom) -->
  <line x1="700" y1="520" x2="700" y2="560" stroke="#ef4444" stroke-width="2" marker-end="url(#arr-red)"/>
  <text x="720" y="540" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="#dc2626" dominant-baseline="middle">RetryError</text>

  <!-- Dead Letter (Bottom) -->
  <rect x="640" y="560" width="120" height="50" rx="6" fill="#450a0a" stroke="#1c0000" stroke-width="2"/>
  <text x="700" y="585" font-family="Arial, sans-serif" font-size="12" font-weight="bold" text-anchor="middle" fill="white" dominant-baseline="middle">Dead Letter</text>

  <!-- Legend -->
  <rect x="30" y="300" width="200" height="180" rx="6" fill="#ffffff" stroke="#d1d5db" stroke-width="1"/>
  <text x="130" y="325" font-family="Arial, sans-serif" font-size="13" font-weight="bold" text-anchor="middle" fill="#1f2937" dominant-baseline="middle">Key Points</text>

  <text x="40" y="350" font-family="Arial, sans-serif" font-size="10" fill="#374151" dominant-baseline="middle">• Retries skip completed steps</text>
  <text x="40" y="370" font-family="Arial, sans-serif" font-size="10" fill="#374151" dominant-baseline="middle">• Payload changes retained</text>
  <text x="40" y="390" font-family="Arial, sans-serif" font-size="10" fill="#374151" dominant-baseline="middle">• UDF pipeline = 1 step</text>
  <text x="40" y="410" font-family="Arial, sans-serif" font-size="10" fill="#374151" dominant-baseline="middle">• Default: 3 attempts</text>
  <text x="40" y="430" font-family="Arial, sans-serif" font-size="10" fill="#374151" dominant-baseline="middle">• Delays: 10, 100, 1000 min</text>
  <text x="40" y="450" font-family="Arial, sans-serif" font-size="10" fill="#374151" dominant-baseline="middle">• Max delay: 1440 min (24h)</text>
  <text x="40" y="470" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="#dc2626" dominant-baseline="middle">• No retries left → Dead Letter</text>

  <!-- Arrow markers -->
  <defs>
    <marker id="arr" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <polygon points="0 0, 10 3, 0 6" fill="#374151"/>
    </marker>
    <marker id="arr-green" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <polygon points="0 0, 10 3, 0 6" fill="#10b981"/>
    </marker>
    <marker id="arr-red" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <polygon points="0 0, 10 3, 0 6" fill="#ef4444"/>
    </marker>
  </defs>
</svg>

