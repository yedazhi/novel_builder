export interface DifyConfig {
  apiBaseUrl: string
  apiKey: string
}

export interface WorkflowInput {
  inputs: Record<string, any>
  response_mode: 'streaming' | 'blocking'
  user: string
}

export interface WorkflowResponse {
  workflow_run_id: string
  task_id: string
  data: {
    id: string
    workflow_id: string
    status: 'running' | 'succeeded' | 'failed' | 'stopped'
    outputs: Record<string, any>
    error?: string
    elapsed_time?: number
    total_tokens?: number
    total_steps: number
    created_at: number
    finished_at: number
  }
}

export interface DifyError {
  status: number
  code: string
  message: string
}

export class DifyApiService {
  private config: DifyConfig

  constructor(config: DifyConfig) {
    this.config = config
  }

  updateConfig(config: Partial<DifyConfig>) {
    this.config = { ...this.config, ...config }
  }

  async runWorkflow(input: WorkflowInput): Promise<WorkflowResponse> {
    const response = await fetch(`${this.config.apiBaseUrl}/workflows/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify(input)
    })

    if (!response.ok) {
      const error: DifyError = await response.json()
      throw new Error(`Dify API Error: ${error.message} (${error.code})`)
    }

    return await response.json()
  }

  async runWorkflowStreaming(
    input: Omit<WorkflowInput, 'response_mode'>,
    onMessage: (data: any) => void,
    onError: (error: Error) => void,
    onComplete: () => void
  ): Promise<void> {
    const streamInput: WorkflowInput = {
      ...input,
      response_mode: 'streaming'
    }

    try {
      const response = await fetch(`${this.config.apiBaseUrl}/workflows/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(streamInput)
      })

      if (!response.ok) {
        const error: DifyError = await response.json()
        throw new Error(`Dify API Error: ${error.message} (${error.code})`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('Failed to get response reader')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              onMessage(data)
            } catch (e) {
              console.warn('Failed to parse SSE data:', line)
            }
          }
        }
      }

      onComplete()
    } catch (error) {
      onError(error instanceof Error ? error : new Error('Unknown error'))
    }
  }
}

// 创建默认实例
export const difyApi = new DifyApiService({
  apiBaseUrl: 'https://api.dify.ai/v1',
  apiKey: ''
})