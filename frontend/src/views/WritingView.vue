<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { difyApi } from '@/services/difyApi'

const props = defineProps<{
  novelId: string
}>()

const appStore = useAppStore()
const router = useRouter()

const showSettingsDialog = ref(false)
const showNextChapterDialog = ref(false)
const nextChapterOverviewInput = ref('')
const showTemplateSelector = ref<'background' | 'ai_writer' | null>(null)

// 特写功能相关状态
const showCloseupDialog = ref(false)
const closeupContent = ref('')
const isGeneratingCloseup = ref(false)
const isCloseupMode = ref(false) // 特写模式开关状态

const editingBackgroundSetting = ref('')
const editingAiWriterSetting = ref('')
const editingNextChapterOverview = ref('')
const selectedBackgroundTemplate = ref<string>('')
const selectedAiWriterTemplate = ref<string>('')

const novel = computed(() => appStore.currentNovel)
const session = computed(() => appStore.writingSession)
const currentChapter = computed(() => appStore.getCurrentChapter())

// 特写功能是否可用（当前章节有内容时）
const canUseCloseup = computed(() => {
  return currentChapter.value && (currentChapter.value.content.trim().length > 0 || session.value.generatedContent.trim().length > 0)
})

onMounted(() => {
  // 确保加载数据
  appStore.loadAllData()

  // 如果当前小说不匹配，重新设置
  if (!novel.value || novel.value.id !== props.novelId) {
    const targetNovel = appStore.novels.find(n => n.id === props.novelId)
    if (targetNovel) {
      appStore.setCurrentNovel(targetNovel)
    } else {
      router.push('/')
      return
    }
  }

  // 如果有当前章节ID，开始编辑该章节
  // 注意：loadAllData已经恢复了writingSession，所以startEditingChapter会保留未保存的内容
  if (appStore.writingSession.currentChapterId) {
    appStore.startEditingChapter(appStore.writingSession.currentChapterId)
  }
})

async function sendToAI() {
  if (!appStore.canSendToAI || !novel.value || !currentChapter.value) return

  // 如果特写模式开启，调用特写生成而不是正常的内容生成
  if (isCloseupMode.value) {
    generateCloseup()
    return
  }

  appStore.setGenerating(true)
  appStore.setLoading(true)

  try {
    difyApi.updateConfig(appStore.difyConfig)

    // 构建发送给 Dify 的数据
    const inputs = {
      user_input: session.value.userInput,
      background_setting: novel.value.backgroundSetting,
      ai_writer_setting: novel.value.aiWriterSetting,
      next_chapter_overview: appStore.getCurrentChapterNextOverview(),
      // 使用当前最新内容：包括未保存的生成内容
      current_chapter_content: appStore.getCurrentChapterLatestContent(),
      history_chapters_content: appStore.getHistoryChapters().map(c => `Chapter ${c.order} ${c.title}: ${c.content}`).join('\n\n')
    }

    // 清空之前的内容，准备接收流式数据
    appStore.setGeneratedContent('')

    await difyApi.runWorkflowStreaming(
      {
        inputs,
        user: `novel_${novel.value.id}_chapter_${currentChapter.value.id}`
      },
      // onMessage - 处理流式数据
      (data: any) => {
        if (data.event === 'text_chunk' && data.data?.text) {
          // 逐步追加文本内容
          const currentContent = session.value.generatedContent
          appStore.setGeneratedContent(currentContent + data.data.text)
        } else if (data.event === 'workflow_finished' && data.data?.outputs?.content) {
          // 工作流完成，设置最终内容
          appStore.setGeneratedContent(data.data.outputs.content)
        }
      },
      // onError
      (error: Error) => {
        appStore.setError(error.message)
      },
      // onComplete
      () => {
        // 流式传输完成
        console.log('Streaming completed')
      }
    )

  } catch (error) {
    appStore.setError(error instanceof Error ? error.message : '生成失败')
  } finally {
    appStore.setGenerating(false)
    appStore.setLoading(false)
  }
}

function openSettingsDialog() {
  if (!novel.value) return

  editingBackgroundSetting.value = novel.value.backgroundSetting
  editingAiWriterSetting.value = novel.value.aiWriterSetting
  editingNextChapterOverview.value = appStore.getCurrentChapterNextOverview()
  selectedBackgroundTemplate.value = ''
  selectedAiWriterTemplate.value = ''

  showSettingsDialog.value = true
}

function saveSettings() {
  if (!novel.value || !currentChapter.value) return

  // 更新小说设定
  appStore.updateNovel(novel.value.id, {
    backgroundSetting: editingBackgroundSetting.value,
    aiWriterSetting: editingAiWriterSetting.value
  })

  // 更新当前章节的下一章概览
  appStore.updateChapter(currentChapter.value.id, {
    nextChapterOverview: editingNextChapterOverview.value
  })

  showSettingsDialog.value = false
}

function saveChapter() {
  // 保存当前章节内容
  if (session.value.generatedContent) {
    appStore.saveCurrentChapter()
  }

  // 将当前章节的下一章概览填入用户输入框
  const currentNextOverview = appStore.getCurrentChapterNextOverview()
  appStore.setUserInput(currentNextOverview)

  // 弹出对话框让用户输入新的下一章概览，预填当前的下一章概览
  nextChapterOverviewInput.value = currentNextOverview
  showNextChapterDialog.value = true
}

function createNextChapter() {
  if (!currentChapter.value || !nextChapterOverviewInput.value.trim()) return

  // 先更新当前章节的下一章概览
  appStore.updateChapter(currentChapter.value.id, {
    nextChapterOverview: nextChapterOverviewInput.value
  })

  showNextChapterDialog.value = false
}

function selectTemplate(type: 'background' | 'ai_writer') {
  showTemplateSelector.value = type
}

function applyTemplate(templateId: string, type: 'background' | 'ai_writer') {
  const template = appStore.getTemplate(templateId)
  if (template) {
    if (type === 'background') {
      editingBackgroundSetting.value = template.content
      selectedBackgroundTemplate.value = template.name
    } else {
      editingAiWriterSetting.value = template.content
      selectedAiWriterTemplate.value = template.name
    }
  }
  showTemplateSelector.value = null
}

function toggleCloseupMode() {
  if (!canUseCloseup.value) return

  isCloseupMode.value = !isCloseupMode.value

  if (isCloseupMode.value) {
    // 开启特写模式，自动生成特写内容
    generateCloseup()
  } else {
    // 关闭特写模式，关闭对话框
    showCloseupDialog.value = false
    closeupContent.value = ''
  }
}

async function generateCloseup() {
  if (!appStore.canSendToAI || !novel.value || !currentChapter.value || !canUseCloseup.value) return

  isGeneratingCloseup.value = true
  appStore.setLoading(true)

  try {
    difyApi.updateConfig(appStore.difyConfig)

    // 构建发送给 Dify 的数据，包含特写指令
    const inputs = {
      user_input: session.value.userInput,
      background_setting: novel.value.backgroundSetting,
      ai_writer_setting: novel.value.aiWriterSetting,
      next_chapter_overview: appStore.getCurrentChapterNextOverview(),
      // 使用当前最新内容：包括未保存的生成内容
      current_chapter_content: appStore.getCurrentChapterLatestContent(),
      history_chapters_content: appStore.getHistoryChapters().map(c => `Chapter ${c.order} ${c.title}: ${c.content}`).join('\n\n'),
      cmd: '特写'
    }

    const response = await difyApi.runWorkflow({
      inputs,
      response_mode: 'blocking',
      user: `novel_${novel.value.id}_chapter_${currentChapter.value.id}_closeup`
    })

    if (response.data.outputs?.content) {
      closeupContent.value = response.data.outputs.content
      showCloseupDialog.value = true
    }

  } catch (error) {
    appStore.setError(error instanceof Error ? error.message : '特写生成失败')
    // 生成失败时关闭特写模式
    isCloseupMode.value = false
  } finally {
    isGeneratingCloseup.value = false
    appStore.setLoading(false)
  }
}

function closeCloseupDialog() {
  showCloseupDialog.value = false
  isCloseupMode.value = false
  closeupContent.value = ''
}

function goBack() {
  // 检查是否有未保存的更改
  if (session.value.hasUnsavedChanges) {
    if (confirm('你有未保存的更改，确定要离开吗？更改将会丢失。')) {
      appStore.discardChanges()
      router.push('/')
    }
  } else {
    router.push('/')
  }
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}
</script>

<template>
  <div v-if="novel" class="writing-view">
    <!-- 头部导航 -->
    <div class="writing-header">
      <div class="header-left">
        <button @click="goBack" class="back-button">
          <span class="back-icon">←</span>
          返回
        </button>
        <div class="novel-info">
          <h2 class="novel-title">{{ novel.title }}</h2>
          <div class="chapter-status">
            <span v-if="currentChapter" class="chapter-info">{{ currentChapter.title }}</span>
            <span v-if="session.hasUnsavedChanges" class="unsaved-indicator">● 未保存</span>
          </div>
        </div>
      </div>

      <div class="header-actions">
        <button v-if="session.hasUnsavedChanges" @click="appStore.discardChanges()" class="discard-button">
          放弃更改
        </button>
        <button @click="openSettingsDialog" class="settings-button">
          <span class="settings-icon">⚙️</span>
          设置
        </button>
      </div>
    </div>

    <!-- 主内容区域 -->
    <div class="writing-content">
      <!-- AI 生成的内容显示区域 -->
      <div class="content-display">
        <div v-if="session.generatedContent" class="generated-content">
          <div class="content-header">
            <h3>AI 生成内容</h3>
            <button @click="saveChapter" class="save-button">
              保存章节
            </button>
          </div>
          <div class="content-text">{{ session.generatedContent }}</div>
        </div>

        <div v-else class="empty-content">
          <div class="empty-icon">✨</div>
          <h3>等待 AI 创作</h3>
          <p>在下方输入框中描述你想要的内容，然后发送给 AI</p>
        </div>
      </div>

      <!-- 用户输入区域 -->
      <div class="input-section">
        <div class="input-container">
          <textarea
            v-model="session.userInput"
            @input="appStore.setUserInput(session.userInput)"
            placeholder="描述你想要的故事情节、人物对话、场景描述等..."
            rows="4"
            :disabled="session.isGenerating"
          ></textarea>
        </div>

        <div class="input-actions">
          <div class="validation-info">
            <div class="validation-item" :class="{ valid: session.userInput.trim() }">
              用户输入: {{ session.userInput.trim() ? '✓' : '✗' }}
            </div>
            <div class="validation-item" :class="{ valid: novel.backgroundSetting.trim() }">
              背景设定: {{ novel.backgroundSetting.trim() ? '✓' : '✗' }}
            </div>
            <div class="validation-item" :class="{ valid: novel.aiWriterSetting.trim() }">
              AI作家设定: {{ novel.aiWriterSetting.trim() ? '✓' : '✗' }}
            </div>
            <div class="validation-item" :class="{ valid: appStore.getCurrentChapterNextOverview().trim() }">
              下一章概览: {{ appStore.getCurrentChapterNextOverview().trim() ? '✓' : '✗' }}
            </div>
          </div>

          <div class="action-buttons">
            <button
              @click="toggleCloseupMode"
              :disabled="!canUseCloseup || isGeneratingCloseup"
              :class="['closeup-toggle', {
                disabled: !canUseCloseup,
                active: isCloseupMode,
                generating: isGeneratingCloseup
              }]"
              :title="canUseCloseup ? (isCloseupMode ? '关闭特写模式' : '开启特写模式') : '需要当前章节有内容才能使用特写功能'"
            >
              <span class="toggle-icon">{{ isCloseupMode ? '✨' : '👁️' }}</span>
              <span class="toggle-text">
                {{ isGeneratingCloseup ? '生成特写中...' : (isCloseupMode ? '特写已开启' : '特写模式') }}
              </span>
            </button>
            <button
              @click="sendToAI"
              :disabled="(!appStore.canSendToAI && !isCloseupMode) || session.isGenerating || (isCloseupMode && !canUseCloseup)"
              :class="['send-button', { 'closeup-mode': isCloseupMode }]"
            >
              {{ session.isGenerating ? '生成中...' : (isCloseupMode ? '✨ 生成特写' : '发送给 AI') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 特写内容展示对话框 -->
    <div v-if="showCloseupDialog" class="dialog-overlay" @click="closeCloseupDialog">
      <div class="dialog large-dialog closeup-dialog" @click.stop>
        <div class="dialog-header">
          <h3>✨ 特写内容</h3>
          <button @click="closeCloseupDialog" class="close-button">×</button>
        </div>
        <div class="dialog-body">
          <div class="closeup-content">
            {{ closeupContent }}
          </div>
          <div class="closeup-note">
            <span class="note-icon">💡</span>
            <span>这是基于当前章节内容生成的特写片段，不会影响原文内容</span>
          </div>
        </div>
        <div class="dialog-footer">
          <button @click="generateCloseup" :disabled="isGeneratingCloseup" class="refresh-closeup-button">
            {{ isGeneratingCloseup ? '重新生成中...' : '🔄 重新生成' }}
          </button>
          <button @click="closeCloseupDialog" class="close-closeup-button">
            关闭特写模式
          </button>
        </div>
      </div>
    </div>

    <!-- 设置对话框 -->
    <div v-if="showSettingsDialog" class="dialog-overlay" @click="showSettingsDialog = false">
      <div class="dialog large-dialog" @click.stop>
        <div class="dialog-header">
          <h3>创作设置</h3>
          <button @click="showSettingsDialog = false" class="close-button">×</button>
        </div>
        <div class="dialog-body">
          <div class="form-group">
            <div class="form-label-with-action">
              <label>背景设定</label>
              <div class="template-actions">
                <button type="button" @click="selectTemplate('background')" class="template-btn">
                  选择模板
                </button>
              </div>
            </div>
            <div v-if="selectedBackgroundTemplate" class="selected-template">
              已选择模板: {{ selectedBackgroundTemplate }}
            </div>
            <textarea
              v-model="editingBackgroundSetting"
              placeholder="描述小说的世界观、时代背景、主要设定等"
              rows="4"
              maxlength="1000"
            ></textarea>
          </div>

          <div class="form-group">
            <div class="form-label-with-action">
              <label>AI作家设定</label>
              <div class="template-actions">
                <button type="button" @click="selectTemplate('ai_writer')" class="template-btn">
                  选择模板
                </button>
              </div>
            </div>
            <div v-if="selectedAiWriterTemplate" class="selected-template">
              已选择模板: {{ selectedAiWriterTemplate }}
            </div>
            <textarea
              v-model="editingAiWriterSetting"
              placeholder="定义AI作家的风格、偏好、写作特点等"
              rows="4"
              maxlength="1000"
            ></textarea>
          </div>

          <div class="form-group">
            <label>下一章概览</label>
            <textarea
              v-model="editingNextChapterOverview"
              placeholder="描述下一章的故事走向、重要事件等"
              rows="3"
              maxlength="500"
            ></textarea>
          </div>
        </div>
        <div class="dialog-footer">
          <button @click="showSettingsDialog = false" class="cancel-button">取消</button>
          <button @click="saveSettings" class="save-settings-button">保存设置</button>
        </div>
      </div>
    </div>

    <!-- 下一章概览输入对话框 -->
    <div v-if="showNextChapterDialog" class="dialog-overlay">
      <div class="dialog" @click.stop>
        <div class="dialog-header">
          <h3>撰写下一章概览</h3>
        </div>
        <div class="dialog-body">
          <div class="form-group">
            <label>下一章概览</label>
            <textarea
              v-model="nextChapterOverviewInput"
              placeholder="描述下一章的故事走向、重要事件、情节发展等"
              rows="4"
              maxlength="500"
            ></textarea>
            <div class="help-text">这将作为下一章创作的指导，帮助 AI 更好地续写故事</div>
          </div>
        </div>
        <div class="dialog-footer">
          <button @click="createNextChapter" :disabled="!nextChapterOverviewInput.trim()" class="create-chapter-button">
            创建下一章
          </button>
        </div>
      </div>
    </div>

    <!-- 模板选择对话框 -->
    <div v-if="showTemplateSelector" class="dialog-overlay" @click="showTemplateSelector = null">
      <div class="dialog template-dialog" @click.stop>
        <div class="dialog-header">
          <h3>选择{{ showTemplateSelector === 'background' ? '背景设定' : 'AI作家设定' }}模板</h3>
          <button @click="showTemplateSelector = null" class="close-button">×</button>
        </div>
        <div class="dialog-body">
          <div
            v-if="(showTemplateSelector === 'background' ? appStore.backgroundTemplates : appStore.aiWriterTemplates).length === 0"
            class="empty-templates"
          >
            <div class="empty-icon">📄</div>
            <p>还没有{{ showTemplateSelector === 'background' ? '背景设定' : 'AI作家设定' }}模板</p>
          </div>
          <div v-else class="template-list">
            <div
              v-for="template in (showTemplateSelector === 'background' ? appStore.backgroundTemplates : appStore.aiWriterTemplates)"
              :key="template.id"
              @click="applyTemplate(template.id, showTemplateSelector)"
              class="template-item"
            >
              <div class="template-header">
                <h4 class="template-name">{{ template.name }}</h4>
                <span class="template-date">{{ formatDate(template.updatedAt) }}</span>
              </div>
              <p v-if="template.description" class="template-description">{{ template.description }}</p>
              <div class="template-preview">{{ template.content.substring(0, 100) }}{{ template.content.length > 100 ? '...' : '' }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.writing-view {
  min-height: calc(100vh - 56px);
  display: flex;
  flex-direction: column;
  background: #f8f9fa;
}

.writing-header {
  background: white;
  border-bottom: 1px solid #e9ecef;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back-button {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: #6c757d;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 6px;
  transition: all 0.2s;
}

.back-button:hover {
  background: #f8f9fa;
  color: #333;
}

.back-icon {
  font-size: 16px;
}

.novel-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.novel-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.chapter-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chapter-info {
  font-size: 12px;
  color: #6c757d;
}

.unsaved-indicator {
  font-size: 12px;
  color: #dc3545;
  font-weight: 500;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.discard-button {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #6c757d;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.discard-button:hover {
  background: #5a6268;
}

.settings-button {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.settings-button:hover {
  background: #0056b3;
}

.settings-icon {
  font-size: 14px;
}

.writing-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  min-height: 0;
}

.content-display {
  flex: 1;
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  min-height: 300px;
  display: flex;
  flex-direction: column;
}

.generated-content {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #e9ecef;
}

.content-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.save-button {
  background: #28a745;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.save-button:hover:not(:disabled) {
  background: #218838;
}

.save-button:disabled {
  background: #dee2e6;
  color: #6c757d;
  cursor: not-allowed;
}

.content-text {
  flex: 1;
  padding: 20px;
  font-size: 16px;
  line-height: 1.8;
  color: #333;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-y: auto;
}

.empty-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  text-align: center;
  color: #6c757d;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-content h3 {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
}

.empty-content p {
  margin: 0;
  font-size: 14px;
}

.input-section {
  flex-shrink: 0;
  background: white;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.input-container {
  margin-bottom: 12px;
}

.input-container textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  font-size: 14px;
  box-sizing: border-box;
  resize: vertical;
  min-height: 100px;
  transition: border-color 0.2s;
}

.input-container textarea:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
}

.input-container textarea:disabled {
  background: #f8f9fa;
  color: #6c757d;
  cursor: not-allowed;
}

.input-actions {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
}

.validation-info {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
}

.validation-item {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  background: #f8f9fa;
  color: #dc3545;
  border: 1px solid #f5c6cb;
}

.validation-item.valid {
  background: #d4edda;
  color: #155724;
  border-color: #c3e6cb;
}

.action-buttons {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}

.closeup-toggle {
  background: #f8f9fa;
  color: #6c757d;
  border: 2px solid #dee2e6;
  border-radius: 8px;
  padding: 12px 20px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
  overflow: hidden;
}

.closeup-toggle:hover:not(:disabled) {
  border-color: #17a2b8;
  color: #17a2b8;
  transform: translateY(-1px);
}

.closeup-toggle.active {
  background: linear-gradient(135deg, #17a2b8, #138496);
  color: white;
  border-color: #17a2b8;
  box-shadow: 0 4px 8px rgba(23, 162, 184, 0.3);
}

.closeup-toggle.active:hover:not(:disabled) {
  background: linear-gradient(135deg, #138496, #117a8b);
  transform: translateY(-1px);
  box-shadow: 0 6px 12px rgba(23, 162, 184, 0.4);
}

.closeup-toggle.generating {
  animation: pulse 2s ease-in-out infinite alternate;
}

@keyframes pulse {
  from {
    box-shadow: 0 0 0 0 rgba(23, 162, 184, 0.7);
  }
  to {
    box-shadow: 0 0 0 10px rgba(23, 162, 184, 0);
  }
}

.closeup-toggle:disabled,
.closeup-toggle.disabled {
  background: #f8f9fa;
  color: #6c757d;
  border-color: #dee2e6;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.toggle-icon {
  font-size: 18px;
  transition: all 0.3s ease;
}

.closeup-toggle.active .toggle-icon {
  animation: sparkle 1.5s ease-in-out infinite;
}

@keyframes sparkle {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
}

.toggle-text {
  font-weight: 500;
}

.refresh-closeup-button {
  background: #17a2b8;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  margin-right: 8px;
}

.refresh-closeup-button:hover:not(:disabled) {
  background: #138496;
}

.refresh-closeup-button:disabled {
  background: #dee2e6;
  color: #6c757d;
  cursor: not-allowed;
}

.send-button {
  background: #007bff;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 12px 24px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.send-button.closeup-mode {
  background: linear-gradient(135deg, #17a2b8, #138496);
  box-shadow: 0 2px 4px rgba(23, 162, 184, 0.3);
}

.send-button:hover:not(:disabled) {
  background: #0056b3;
}

.send-button.closeup-mode:hover:not(:disabled) {
  background: linear-gradient(135deg, #138496, #117a8b);
  box-shadow: 0 4px 8px rgba(23, 162, 184, 0.4);
}

.send-button:disabled {
  background: #dee2e6;
  color: #6c757d;
  cursor: not-allowed;
}

/* 对话框样式 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.dialog {
  background: white;
  border-radius: 12px;
  width: 100%;
  max-width: 400px;
  max-height: 90vh;
  overflow: hidden;
  animation: dialogSlideIn 0.2s ease-out;
}

.large-dialog {
  max-width: 600px;
}

@keyframes dialogSlideIn {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #e9ecef;
}

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #333;
}

.close-button {
  background: none;
  border: none;
  font-size: 24px;
  color: #6c757d;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
}

.close-button:hover {
  background: #f8f9fa;
  color: #333;
}

.dialog-body {
  padding: 20px;
  max-height: 60vh;
  overflow-y: auto;
}

.form-group {
  margin-bottom: 16px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

.form-group textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  font-size: 14px;
  box-sizing: border-box;
  transition: border-color 0.2s;
  resize: vertical;
  min-height: 80px;
}

.form-group textarea:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
}

.help-text {
  margin-top: 6px;
  font-size: 12px;
  color: #6c757d;
  line-height: 1.4;
}

.dialog-footer {
  display: flex;
  gap: 12px;
  padding: 20px;
  border-top: 1px solid #e9ecef;
  justify-content: flex-end;
}

.cancel-button,
.save-settings-button,
.create-chapter-button {
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.cancel-button {
  background: #f8f9fa;
  color: #6c757d;
}

.cancel-button:hover {
  background: #e9ecef;
  color: #333;
}

.save-settings-button {
  background: #007bff;
  color: white;
}

.save-settings-button:hover {
  background: #0056b3;
}

.create-chapter-button {
  background: #28a745;
  color: white;
}

.create-chapter-button:hover:not(:disabled) {
  background: #218838;
}

.create-chapter-button:disabled {
  background: #dee2e6;
  color: #6c757d;
  cursor: not-allowed;
}

/* 模板相关样式 */
.form-label-with-action {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.template-actions {
  display: flex;
  gap: 8px;
}

.template-btn {
  padding: 4px 8px;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  background: white;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.template-btn:hover:not(:disabled) {
  background: #e9ecef;
  border-color: #adb5bd;
}

.selected-template {
  margin-bottom: 8px;
  padding: 4px 8px;
  background: #e7f3ff;
  border: 1px solid #b3d7ff;
  border-radius: 4px;
  font-size: 12px;
  color: #0066cc;
}

.template-dialog {
  max-width: 600px;
}

.empty-templates {
  text-align: center;
  padding: 40px 20px;
  color: #6c757d;
}

.empty-icon {
  font-size: 32px;
  margin-bottom: 12px;
}

.template-list {
  max-height: 400px;
  overflow-y: auto;
}

.template-item {
  padding: 12px;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.template-item:hover {
  background: #f8f9fa;
  border-color: #007bff;
}

.template-item:last-child {
  margin-bottom: 0;
}

.template-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.template-name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.template-date {
  font-size: 11px;
  color: #6c757d;
}

.template-description {
  margin: 0 0 8px 0;
  font-size: 12px;
  color: #495057;
  font-style: italic;
}

.template-preview {
  font-size: 12px;
  color: #6c757d;
  line-height: 1.4;
}

/* 特写对话框样式 */
.closeup-dialog {
  max-width: 800px;
}

.closeup-content {
  background: var(--color-surface-secondary);
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
  font-size: 16px;
  line-height: 1.8;
  color: var(--color-text-primary);
  white-space: pre-wrap;
  word-wrap: break-word;
  min-height: 200px;
  max-height: 400px;
  overflow-y: auto;
}

.closeup-note {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #e7f3ff;
  border: 1px solid #b3d7ff;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  color: #0066cc;
}

.note-icon {
  font-size: 14px;
}

.close-closeup-button {
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.close-closeup-button:hover {
  background: var(--color-primary-hover);
}

@media (max-width: 768px) {
  .writing-content {
    padding: 12px;
  }

  .input-actions {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .validation-info {
    order: 2;
  }

  .action-buttons {
    order: 1;
    flex-direction: column;
  }

  .closeup-toggle,
  .send-button {
    width: 100%;
  }

  .closeup-dialog {
    max-width: 90vw;
  }

  .closeup-content {
    font-size: 14px;
    padding: 16px;
  }
}
</style>