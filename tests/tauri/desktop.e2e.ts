import { browser, $, expect } from '@wdio/globals'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
let mainWindowHandle: string

interface OverlayVisibilityStatus {
  kind: string
  open: boolean
  ready: boolean
  visible: boolean
  visibilityObserved: boolean
  displayed: boolean
  withinMonitorBounds?: boolean
}

interface OverlayShortcutStatus {
  shortcut: string
  registered: boolean
  mode: string
}

async function getOverlayVisibility(): Promise<OverlayVisibilityStatus[]> {
  return (await browser.executeAsync((done) => {
    window.__TAURI_INTERNALS__?.invoke('get_overlay_visibility', {}).then(done)
  })) as OverlayVisibilityStatus[]
}

async function getOverlayShortcutStatus(): Promise<OverlayShortcutStatus> {
  return (await browser.executeAsync((done) => {
    window.__TAURI_INTERNALS__
      ?.invoke('get_overlay_shortcut_status', {})
      .then(done)
  })) as OverlayShortcutStatus
}

async function closeRecommendationOverlay() {
  await browser.executeAsync((done) => {
    window.__TAURI_INTERNALS__
      ?.invoke('close_overlay', { kind: 'recommendation' })
      .then(done)
  })
}

async function switchToMainWindow() {
  const handles = await browser.getWindowHandles()
  if (!mainWindowHandle || !handles.includes(mainWindowHandle)) {
    throw new Error('The OMG-Draft-Seer main window handle is unavailable')
  }
  await browser.switchToWindow(mainWindowHandle)
}

async function pressWindowsGlobalF8() {
  if (process.platform !== 'win32') {
    throw new Error('The native global-shortcut E2E is Windows-only')
  }
  await execFile(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$shell = New-Object -ComObject WScript.Shell; $shell.SendKeys('{F8}')",
    ],
    { windowsHide: true },
  )
}

describe('Tauri desktop application', () => {
  before(async () => {
    await browser.waitUntil(
      async () => await $('[data-testid="app-shell"]').isDisplayed(),
      {
        timeoutMsg: 'OMG-Draft-Seer main window did not become ready',
      },
    )
    mainWindowHandle = await browser.getWindowHandle()
  })

  beforeEach(async () => {
    await switchToMainWindow()
  })

  after(async () => {
    await switchToMainWindow()
    await browser.executeAsync((done) => {
      window.localStorage.setItem('omg-overlay-shortcut-key-v1', 'Tab')
      window.__TAURI_INTERNALS__
        ?.invoke('set_overlay_shortcut', {
          shortcut: 'Tab',
          enabled: true,
          mode: 'trigger',
        })
        .then(done)
        .catch(() => done())
    })
    await closeRecommendationOverlay()
  })

  it('switches pages through the native WebView navigation', async () => {
    for (const page of [
      'analysis',
      'build',
      'layout',
      'database',
      'pairs',
      'draft',
    ]) {
      const tab = await $(`[data-testid="nav-${page}"]`)
      await tab.click()
      await expect(tab).toHaveAttribute('aria-current', 'page')
    }
  })

  it('exposes the native autostart setting without changing it', async () => {
    await (await $('[data-testid="open-settings"]')).click()
    const toggle = await $('[data-testid="autostart-toggle"]')

    await expect(toggle).toBeDisplayed()
    await expect(toggle).toBeEnabled()
    await expect(toggle).toHaveAttribute('role', 'switch')
    await (await $('[data-testid="settings-back"]')).click()
  })

  it('persists the selected locale across a WebView refresh', async () => {
    await (await $('[data-testid="open-settings"]')).click()
    await expect($('[data-testid="settings-page"]')).toBeDisplayed()
    await (await $('[data-testid="locale-en"]')).click()
    await expect($('[data-testid="locale-en"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await browser.refresh()
    await browser.waitUntil(
      async () => await $('[data-testid="app-shell"]').isDisplayed(),
      {
        timeoutMsg: 'OMG-Draft-Seer main window did not recover after refresh',
      },
    )
    await expect($('[data-testid="nav-analysis"]')).toHaveAttribute(
      'aria-label',
      'Skill Analysis',
    )
    await (await $('[data-testid="open-settings"]')).click()
    await (await $('[data-testid="locale-zh-CN"]')).click()
    await (await $('[data-testid="settings-back"]')).click()
    await expect($('[data-testid="nav-analysis"]')).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('filters tier and pair data in the desktop window', async () => {
    await (await $('[data-testid="nav-database"]')).click()
    await (await $('[data-testid="tier-search"]')).setValue('no-such-ability')
    await expect($('[data-testid="tier-no-results"]')).toBeDisplayed()

    await (await $('[data-testid="nav-pairs"]')).click()
    await (await $('[data-testid="pairs-search"]')).setValue('no-such-pair')
    await expect($('[data-testid="pairs-empty"]')).toBeDisplayed()
    const toggle = await $('[data-testid="pairs-exclude-same-hero"]')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens and closes the assistant overlay from its button', async () => {
    await (await $('[data-testid="nav-database"]')).click()
    const handles = await browser.getWindowHandles()
    const toggle = await $('[data-testid="overlay-toggle-recommendation"]')

    await toggle.click()
    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length > handles.length,
      {
        timeoutMsg: 'Overlay button did not create the assistant overlay',
      },
    )
    await browser.waitUntil(
      async () => {
        const visibility = await getOverlayVisibility()
        return visibility.some(
          (status) =>
            status.kind === 'recommendation' &&
            status.open &&
            status.ready &&
            status.visibilityObserved &&
            status.visible &&
            status.displayed &&
            status.withinMonitorBounds === true,
        )
      },
      {
        timeoutMsg:
          'Overlay button did not produce a ready, OS-visible assistant inside the target monitor',
      },
    )

    await switchToMainWindow()
    await (await $('[data-testid="overlay-toggle-recommendation"]')).click()
    await browser.waitUntil(
      async () => {
        const visibility = await getOverlayVisibility()
        return visibility.some(
          (status) =>
            status.kind === 'recommendation' &&
            !status.open &&
            status.visibilityObserved &&
            !status.visible &&
            !status.displayed,
        )
      },
      {
        timeoutMsg: 'Overlay button did not hide the native assistant window',
      },
    )
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('changes draft strategy in the native window', async () => {
    await (await $('[data-testid="nav-draft"]')).click()
    const strategy = await $('[data-testid="draft-strategy-pair-first"]')
    await strategy.click()
    await expect(strategy).toHaveAttribute('aria-selected', 'true')
  })

  it('toggles the assistant overlay through the native global shortcut', async () => {
    await closeRecommendationOverlay()
    await (await $('[data-testid="nav-analysis"]')).click()
    await (await $('[data-testid="open-settings"]')).click()
    await (await $('[data-testid="overlay-shortcut-capture"]')).click()
    await browser.keys(['F8'])
    await browser.waitUntil(
      async () =>
        (
          await $('[data-testid="overlay-shortcut-capture"]').getText()
        ).includes('F8'),
      { timeoutMsg: 'F8 shortcut was not saved in Settings' },
    )
    await browser.waitUntil(
      async () => {
        const status = await getOverlayShortcutStatus()
        return (
          status.shortcut === 'F8' &&
          status.registered &&
          status.mode === 'trigger'
        )
      },
      { timeoutMsg: 'F8 shortcut was not registered by the native shell' },
    )
    await (await $('[data-testid="settings-back"]')).click()

    await pressWindowsGlobalF8()
    await browser.waitUntil(
      async () => {
        const visibility = await getOverlayVisibility()
        return visibility.some(
          (status) =>
            status.kind === 'recommendation' &&
            status.open &&
            status.ready &&
            status.visibilityObserved &&
            status.visible &&
            status.displayed &&
            status.withinMonitorBounds === true,
        )
      },
      {
        timeoutMsg:
          'F8 did not produce a ready, OS-visible assistant inside the target monitor',
      },
    )

    await pressWindowsGlobalF8()
    await browser.waitUntil(
      async () => {
        const visibility = await getOverlayVisibility()
        return visibility.some(
          (status) =>
            status.kind === 'recommendation' &&
            !status.open &&
            status.visibilityObserved &&
            !status.visible &&
            !status.displayed,
        )
      },
      { timeoutMsg: 'F8 did not hide the native assistant window' },
    )

    await (await $('[data-testid="open-settings"]')).click()
    await (await $('[data-testid="overlay-shortcut-reset"]')).click()
    await browser.waitUntil(
      async () =>
        (
          await $('[data-testid="overlay-shortcut-capture"]').getText()
        ).includes('Tab'),
      { timeoutMsg: 'Default Tab shortcut was not restored' },
    )
    await browser.waitUntil(
      async () => {
        const status = await getOverlayShortcutStatus()
        return status.shortcut === 'Tab' && status.registered
      },
      { timeoutMsg: 'Default Tab shortcut was not restored natively' },
    )
    await (await $('[data-testid="settings-back"]')).click()
    await expect($('[data-testid="nav-analysis"]')).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})
