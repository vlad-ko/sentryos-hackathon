import { query } from '@anthropic-ai/claude-agent-sdk'
import * as Sentry from '@sentry/nextjs'

const SYSTEM_PROMPT = `You are a helpful personal assistant designed to help with general research, questions, and tasks.

Your role is to:
- Answer questions on any topic accurately and thoroughly
- Help with research by searching the web for current information
- Assist with writing, editing, and brainstorming
- Provide explanations and summaries of complex topics
- Help solve problems and think through decisions

Guidelines:
- Be friendly, clear, and conversational
- Use web search when you need current information, facts you're unsure about, or real-time data
- Keep responses concise but complete - expand when the topic warrants depth
- Use markdown formatting when it helps readability (bullet points, code blocks, etc.)
- Be honest when you don't know something and offer to search for answers`

interface MessageInput {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(request: Request) {
  const requestStart = Date.now()

  try {
    const { messages } = await request.json() as { messages: MessageInput[] }

    if (!messages || !Array.isArray(messages)) {
      Sentry.logger.warn('Chat request rejected: messages array missing or invalid')
      Sentry.metrics.count('chat.request.invalid', 1, { attributes: { reason: 'missing_messages' } })
      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Get the last user message
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()
    if (!lastUserMessage) {
      Sentry.logger.warn('Chat request rejected: no user message found')
      Sentry.metrics.count('chat.request.invalid', 1, { attributes: { reason: 'no_user_message' } })
      return new Response(
        JSON.stringify({ error: 'No user message found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    Sentry.logger.info('Chat request received', {
      messageCount: messages.length,
      promptLength: lastUserMessage.content.length,
    })
    Sentry.metrics.count('chat.request.started')
    Sentry.metrics.distribution('chat.prompt.length', lastUserMessage.content.length)
    Sentry.metrics.distribution('chat.conversation.depth', messages.length)

    // Build conversation context
    const conversationContext = messages
      .slice(0, -1) // Exclude the last message since we pass it as the prompt
      .map((m: MessageInput) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n')

    const fullPrompt = conversationContext
      ? `${SYSTEM_PROMPT}\n\nPrevious conversation:\n${conversationContext}\n\nUser: ${lastUserMessage.content}`
      : `${SYSTEM_PROMPT}\n\nUser: ${lastUserMessage.content}`

    // Create a streaming response
    const encoder = new TextEncoder()
    let toolCount = 0
    let textChunkCount = 0
    const toolsUsed: string[] = []

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Use the claude-agent-sdk query function with all default tools enabled
          for await (const message of query({
            prompt: fullPrompt,
            options: {
              maxTurns: 10,
              // Use the preset to enable all Claude Code tools including WebSearch
              tools: { type: 'preset', preset: 'claude_code' },
              // Bypass all permission checks for automated tool execution
              permissionMode: 'bypassPermissions',
              allowDangerouslySkipPermissions: true,
              // Enable partial messages for real-time text streaming
              includePartialMessages: true,
              // Set working directory to the app's directory for sandboxing
              cwd: process.cwd(),
            }
          })) {
            // Handle streaming text deltas (partial messages)
            if (message.type === 'stream_event' && 'event' in message) {
              const event = message.event
              // Handle content block delta events for text streaming
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                textChunkCount++
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ type: 'text_delta', text: event.delta.text })}\n\n`
                ))
              }
            }

            // Send tool start events from assistant messages
            if (message.type === 'assistant' && 'message' in message) {
              const content = message.message?.content
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_use') {
                    toolCount++
                    toolsUsed.push(block.name)
                    Sentry.logger.info('Agent tool invoked', {
                      tool: block.name,
                      toolIndex: toolCount,
                    })
                    Sentry.metrics.count('chat.tool.invoked', 1, { attributes: { tool: block.name } })
                    controller.enqueue(encoder.encode(
                      `data: ${JSON.stringify({ type: 'tool_start', tool: block.name })}\n\n`
                    ))
                  }
                }
              }
            }

            // Send tool progress updates
            if (message.type === 'tool_progress') {
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'tool_progress', tool: message.tool_name, elapsed: message.elapsed_time_seconds })}\n\n`
              ))
            }

            // Signal completion
            if (message.type === 'result' && message.subtype === 'success') {
              const durationMs = Date.now() - requestStart
              Sentry.logger.info('Chat request completed successfully', {
                durationMs,
                toolCount,
                toolsUsed: toolsUsed.join(', '),
                textChunks: textChunkCount,
              })
              Sentry.metrics.count('chat.request.completed', 1, { attributes: { status: 'success' } })
              Sentry.metrics.distribution('chat.request.duration_ms', durationMs)
              Sentry.metrics.distribution('chat.tools.per_request', toolCount)
              Sentry.metrics.distribution('chat.text_chunks.per_request', textChunkCount)
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'done' })}\n\n`
              ))
            }

            // Handle errors
            if (message.type === 'result' && message.subtype !== 'success') {
              const durationMs = Date.now() - requestStart
              Sentry.logger.error('Chat query did not complete successfully', {
                subtype: message.subtype,
                durationMs,
                toolCount,
              })
              Sentry.metrics.count('chat.request.completed', 1, { attributes: { status: 'failed' } })
              Sentry.metrics.distribution('chat.request.duration_ms', durationMs)
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'error', message: 'Query did not complete successfully' })}\n\n`
              ))
            }
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (error) {
          const durationMs = Date.now() - requestStart
          Sentry.logger.error('Chat stream error', {
            error: error instanceof Error ? error.message : String(error),
            durationMs,
            toolCount,
          })
          Sentry.metrics.count('chat.request.completed', 1, { attributes: { status: 'stream_error' } })
          Sentry.metrics.distribution('chat.request.duration_ms', durationMs)
          console.error('Stream error:', error)
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'error', message: 'Stream error occurred' })}\n\n`
          ))
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    const durationMs = Date.now() - requestStart
    Sentry.logger.error('Chat API fatal error', {
      error: error instanceof Error ? error.message : String(error),
      durationMs,
    })
    Sentry.metrics.count('chat.request.completed', 1, { attributes: { status: 'fatal_error' } })
    console.error('Chat API error:', error)

    return new Response(
      JSON.stringify({ error: 'Failed to process chat request. Check server logs for details.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
