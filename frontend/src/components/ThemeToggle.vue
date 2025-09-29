<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '@/stores/app'
import type { ThemeMode } from '@/stores/app'

const appStore = useAppStore()

const currentMode = computed(() => appStore.settings.themeMode)
const effectiveTheme = computed(() => appStore.currentTheme)

const themeOptions = [
  { value: 'light' as ThemeMode, label: '浅色', icon: '☀️' },
  { value: 'dark' as ThemeMode, label: '深色', icon: '🌙' },
  { value: 'system' as ThemeMode, label: '跟随系统', icon: '💻' }
]

function setTheme(mode: ThemeMode) {
  appStore.setThemeMode(mode)
}
</script>

<template>
  <div class="theme-toggle">
    <div class="theme-toggle-label">
      <span class="theme-icon">🎨</span>
      <span>主题模式</span>
    </div>

    <div class="theme-options">
      <button
        v-for="option in themeOptions"
        :key="option.value"
        @click="setTheme(option.value)"
        :class="['theme-option', { active: currentMode === option.value }]"
        :title="option.label"
      >
        <span class="theme-option-icon">{{ option.icon }}</span>
        <span class="theme-option-label">{{ option.label }}</span>
      </button>
    </div>

    <div class="current-theme-indicator">
      <span class="current-theme-text">
        当前: {{ effectiveTheme === 'dark' ? '深色' : '浅色' }}
        {{ currentMode === 'system' ? '(跟随系统)' : '' }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.theme-toggle {
  padding: 16px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  margin-bottom: 16px;
}

.theme-toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.theme-icon {
  font-size: 16px;
}

.theme-options {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.theme-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px;
  background: var(--color-surface-secondary);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-text-secondary);
}

.theme-option:hover {
  background: var(--color-border);
  border-color: var(--color-primary);
}

.theme-option.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.theme-option-icon {
  font-size: 18px;
}

.theme-option-label {
  font-size: 12px;
  font-weight: 500;
}

.current-theme-indicator {
  text-align: center;
}

.current-theme-text {
  font-size: 12px;
  color: var(--color-text-muted);
}

@media (max-width: 768px) {
  .theme-options {
    flex-direction: column;
  }

  .theme-option {
    flex-direction: row;
    justify-content: center;
  }
}</style>