import { browser, $, expect } from '@wdio/globals'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const screenshotPath = resolve('tests/fixtures/{241DAD27-9A37-4364-BF08-68998F993992}.jpg')

async function setScreenshotInput() {
  const imageBase64 = (await readFile(screenshotPath)).toString('base64')

  await browser.execute((base64) => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="screenshot-input"]')
    if (!input) throw new Error('Screenshot input was not found')

    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
    const file = new File([bytes], 'desktop-e2e.jpg', { type: 'image/jpeg' })
    const transfer = new DataTransfer()
    transfer.items.add(file)

    const filesSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set
    filesSetter?.call(input, transfer.files)
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, imageBase64)
}

describe('Tauri desktop application', () => {
  before(async () => {
    await browser.waitUntil(async () => await $('[data-testid="app-shell"]').isDisplayed(), {
      timeoutMsg: 'OMG-Draft-Seer main window did not become ready',
    })
  })

  it('switches pages through the native WebView navigation', async () => {
    for (const page of ['analysis', 'layout', 'database', 'pairs', 'draft']) {
      const tab = await $(`[data-testid="nav-${page}"]`)
      await tab.click()
      await expect(tab).toHaveAttribute('aria-current', 'page')
    }
  })

  it('persists the selected locale across a WebView refresh', async () => {
    await (await $('[data-testid="locale-en"]')).click()
    await expect($('[data-testid="nav-analysis"]')).toHaveText('Skill Analysis')
    await browser.refresh()
    await expect($('[data-testid="nav-analysis"]')).toHaveText('Skill Analysis')
    await (await $('[data-testid="locale-zh-CN"]')).click()
  })

  it('filters tier and pair data in the desktop window', async () => {
    await (await $('[data-testid="nav-database"]')).click()
    await (await $('[data-testid="tier-search"]')).setValue('no-such-ability')
    await expect($('.tier-no-results')).toBeDisplayed()

    await (await $('[data-testid="nav-pairs"]')).click()
    await (await $('[data-testid="pairs-search"]')).setValue('no-such-pair')
    await expect($('.pairs-empty')).toBeDisplayed()
    const toggle = await $('[data-testid="pairs-exclude-same-hero"]')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('uploads a screenshot and exposes layout reset controls', async () => {
    await (await $('[data-testid="nav-analysis"]')).click()
    await setScreenshotInput()
    await expect($('.screenshot-frame')).toBeDisplayed()
    await browser.waitUntil(async () => await $('[data-testid="accept-suggestions"]').isDisplayed(), {
      timeout: 60_000,
      timeoutMsg: 'Screenshot recognition did not produce selectable candidates',
    })
    await (await $('[data-testid="accept-suggestions"]')).click()

    await (await $('[data-testid="nav-layout"]')).click()
    await (await $('[data-testid="layout-reset"]')).click()
    await expect($('.layout-reset-dialog')).toBeDisplayed()
  })

  it('changes draft strategy and opens a native overlay window', async () => {
    await (await $('[data-testid="nav-draft"]')).click()
    const strategy = await $('[data-testid="draft-strategy-pair-first"]')
    await strategy.click()
    await expect(strategy).toHaveAttribute('aria-selected', 'true')

    await (await $('[data-testid="nav-database"]')).click()
    const handles = await browser.getWindowHandles()
    await (await $('[data-testid="overlay-toggle-tier"]')).click()
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length > handles.length, {
      timeoutMsg: 'Tier overlay window did not open',
    })
  })
})
