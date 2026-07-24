import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('coachconnect-language', 'es'))
  await page.goto('/')
})

test('completa el cuestionario y llega a resultados', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /encuentra tu próximo entrenador/i })).toBeVisible()
  await page.getByRole('button', { name: /fitness & fuerza/i }).click()
  await page.getByRole('button', { name: /musculación/i }).click()
  await page.getByRole('button', { name: /ganar fuerza/i }).click()
  await page.getByRole('button', { name: /online/i }).click()
  await page.getByRole('button', { name: /flexible/i }).click()
  await page.getByRole('button', { name: /cualquier sitio/i }).click()
  await page.getByRole('button', { name: /flexible/i }).click()
  await page.getByRole('button', { name: /me da igual/i }).click()
  await page.getByRole('button', { name: /la mejor coincidencia/i }).click()

  await expect(page).toHaveURL(/\/buscar\?/)
  await expect(page.getByRole('heading', { name: /fitness.*encajan contigo/i })).toBeVisible()
})

test('cambia el idioma principal y abre autenticación', async ({ page }) => {
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByRole('heading', { name: /find your next coach/i })).toBeVisible()
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page.getByRole('button', { name: /continue with apple/i })).toBeVisible()
})

test('mantiene la home en un viewport y previsualiza con teclado', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'La regla sin scroll solo aplica a escritorio')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.reload()

  const pageFitsViewport = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)
  expect(pageFitsViewport).toBe(true)

  const martial = page.getByRole('button', { name: /artes marciales/i })
  await martial.focus()
  await expect(page.getByRole('heading', { level: 2, name: /artes marciales/i })).toBeVisible()
})
