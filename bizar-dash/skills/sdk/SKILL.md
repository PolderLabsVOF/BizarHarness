---
name: sdk
description: @polderlabs/bizar-sdk usage - building AI agents on Cloudflare Workers using the Agents SDK. Covers Agent class, state management, callable RPC, Workflows, durable execution, queues, retries, observability, and React hooks.
---

# @polderlabs/bizar-sdk

The Bizar SDK lets you build AI-powered agents on Cloudflare Workers using the Agents SDK. It runs on Cloudflare's global network with automatic scaling and durable state.

## Installation

```bash
npm install @polderlabs/bizar-sdk
```

## Core Concepts

### Agent Class

```typescript
import { Agent } from '@polderlabs/bizar-sdk';

const agent = new Agent({
  name: 'my-agent',
  model: 'minimax/MiniMax-M3',
  systemPrompt: 'You are a helpful assistant.',
  env: { MINIMAX_API_KEY },
});

export default agent;
```

### State Management

Agents maintain durable state across requests using Cloudflare Durable Objects:

```typescript
const state = await agent.state.get();
// { count: 0, lastSeen: Date }
await agent.state.patch({ count: state.count + 1 });
```

### Callable RPC

Agents expose RPC methods callable via HTTP:

```typescript
agent.method('greet', async (name: string) => {
  return `Hello, ${name}!`;
});
```

Call from the dashboard or any HTTP client:
```bash
curl -X POST https://my-agent.workers.dev/rpc/greet \
  -H "Content-Type: application/json" \
  -d '{"name": "World"}'
```

## Workflows

For long-running tasks, use Workflows (durable execution):

```typescript
import { Workflow } from '@polderlabs/bizar-sdk';

const workflow = new Workflow({
  name: 'data-processor',
  retry: { maxAttempts: 3, backoff: 'exponential' },
});

workflow.step('fetch', async ({ input }) => {
  return await fetch(input.url);
});

workflow.step('process', async ({ input, state }) => {
  const data = await input.json();
  return { ...data, processed: true };
});

export default workflow;
```

## Queues

For async message processing:

```typescript
import { Queue } from '@polderlabs/bizar-sdk';

const queue = new Queue('my-queue', {
  maxRetries: 3,
  batchSize: 10,
});

queue.processor(async (messages) => {
  for (const msg of messages) {
    console.log('Received:', msg.body);
  }
});
```

## Observability

Built-in tracing to Cloudflare Analytics:
- Request logs
- Token usage
- Error rates
- Latency percentiles

## React Hooks

For building chat interfaces:

```typescript
import { useAgent, useSession } from '@polderlabs/bizar-sdk/react';

function ChatComponent({ agentName }: { agentName: string }) {
  const { messages, send, isLoading } = useAgent(agentName);

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>{m.role}: {m.content}</div>
      ))}
      <input onSend={send} disabled={isLoading} />
    </div>
  );
}
```

## Deployment

```bash
npx wrangler deploy
```

Workers are deployed to Cloudflare's global network. No cold starts, automatic HTTPS.
