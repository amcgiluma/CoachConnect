import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('coachconnect-language', 'es'))
  await page.goto('/')
})

test('completa el cuestionario y llega a resultados', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /encuentra tu próximo entrenador/i })).toBeVisible()
  await page.getByRole('button', { name: /fitness & fuerza/i }).click()
  await page.getByRole('button', { name: /musculación/i }).click()
  await expect(page.getByRole('heading', { name: /cómo quieres entrenar/i })).toBeVisible()
  await page.getByRole('button', { name: /online/i }).click()
  await page.getByRole('button', { name: /flexible/i }).click()
  await page.getByRole('button', { name: /me da igual/i }).click()

  await expect(page).toHaveURL(/\/buscar\?/)
  await expect(page).not.toHaveURL(/(?:goal|availability|priority)=/)
  await expect(page.getByRole('heading', { name: /fitness.*encajan contigo/i })).toBeVisible()
})

test('cambia el idioma principal y abre autenticación', async ({ page }) => {
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByRole('heading', { name: /find your next coach/i })).toBeVisible()
  if ((page.viewportSize()?.width || 0) <= 850) {
    await expect(page.getByRole('button', { name: /choose what to train/i })).toBeVisible()
  } else {
    await expect(page.getByRole('button', { name: /fitness & strength/i })).toBeVisible()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await page.getByRole('button', { name: /log in/i }).click()
  await expect(page.getByRole('button', { name: /continue with apple/i })).toBeVisible()
})

test('mantiene visible el contenido crítico sin overflow horizontal', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /encuentra tu próximo entrenador/i })).toBeVisible()
  await expect(page.getByLabel(/tu matching de entrenador/i)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)

  if ((page.viewportSize()?.width || 0) <= 850) {
    const selectorCta = page.getByRole('button', { name: /elegir qué quiero entrenar/i })
    await expect(selectorCta).toBeVisible()
    await selectorCta.click()
  } else {
    await page.getByRole('button', { name: /elegir especialidad/i }).click()
  }
  await expect(page.getByRole('button', { name: /fitness & fuerza/i })).toBeFocused()
  await expect(page.getByRole('button', { name: /fitness & fuerza/i })).toBeInViewport()
})

test('previsualiza con teclado y conserva accesible el contenido largo', async ({ page }) => {
  const martial = page.getByRole('button', { name: /artes marciales/i })
  await martial.focus()
  await expect(page.getByRole('heading', { level: 2, name: /artes marciales/i })).toBeVisible()
  await expect(page.locator('.match-core-photo img')).toHaveAttribute('src', '/images/categories/martial.webp')
  await expect(page.getByRole('button', { name: /artes marciales/i })).toBeInViewport()
})

test('omite objetivos y acepta cualquier ubicación', async ({ page }) => {
  await page.route('https://photon.komoot.io/api/**', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ features: [{ properties: { osm_type: 'N', osm_id: 1, osm_key: 'place', name: 'Granada', state: 'Andalucía', countrycode: 'ES', type: 'city' } }] }),
  }))
  await page.getByRole('button', { name: /artes marciales/i }).click()
  await expect(page.getByLabel(/especialidad elegida: artes marciales/i).locator('img')).toHaveAttribute('src', '/images/categories/martial.webp')
  await page.getByRole('button', { name: /muay thai/i }).click()
  await expect(page.getByRole('heading', { name: /cómo quieres entrenar/i })).toBeVisible()
  await page.getByRole('button', { name: /^presencial$/i }).click()
  await page.getByLabel(/ciudad, municipio, barrio o código postal/i).fill('Granada')
  await page.getByRole('option', { name: /granada.*andalucía/i }).click()
  await page.getByRole('button', { name: /continuar con esta ubicación/i }).click()
  await expect(page.getByRole('heading', { name: /qué presupuesto tienes/i })).toBeVisible()
})

test('omite la ubicación cuando la modalidad es online', async ({ page }) => {
  await page.getByRole('button', { name: /danza & movimiento/i }).click()
  await page.getByRole('button', { name: /danza urbana/i }).click()
  await page.getByRole('button', { name: /^online$/i }).click()
  await expect(page.getByRole('heading', { name: /qué presupuesto tienes/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /dónde quieres entrenar/i })).toHaveCount(0)
})

test('muestra fotografía humana sin perder los nombres de categoría', async ({ page }) => {
  await expect(page.locator('.coach-proof .coach-avatar img')).toHaveCount(4)
  await expect(page.locator('.match-core-photo img')).toBeVisible()
  await expect(page.getByRole('button', { name: /fitness & fuerza/i })).toBeVisible()
})

test('muestra un perfil público veraz y responsive', async ({ page }) => {
  await page.goto('/entrenadores/ines-martin')

  await expect(page.getByRole('heading', { name: 'Inés Martín' })).toBeVisible()
  await expect(page.getByText(/4\.9 sobre 5 en 42 valoraciones/i)).toBeVisible()
  await expect(page.getByText(/explica con claridad, escucha/i)).toHaveCount(0)
  await expect(page.getByRole('link', { name: /eres entrenador/i })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})

test('el carrusel móvil avanza a una categoría exacta', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile-'), 'Los controles de carrusel se muestran solo en móvil')
  await page.getByRole('button', { name: /categoría siguiente/i }).click()

  await expect(page.getByRole('button', { name: /artes marciales/i })).toBeFocused()
  await expect(page.getByRole('heading', { level: 2, name: /artes marciales/i })).toBeVisible()
})

test('respeta movimiento reducido y ampliación de texto', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()

  const transitionDuration = await page.locator('.match-marker').evaluate((element) => getComputedStyle(element).transitionDuration)
  expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.01)

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  await expect(page.getByRole('button', { name: /elegir especialidad/i })).toBeVisible()
})

test('la rueda no invade los criterios con zoom equivalente al 200%', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1920', 'Una anchura CSS de 960 px simula el zoom 200% sobre 1920 px')
  await page.setViewportSize({ width: 960, height: 540 })
  await page.reload()

  const core = await page.locator('.match-core').boundingBox()
  const orbit = await page.locator('.match-orbit').boundingBox()
  const criteria = await page.locator('.match-criteria').boundingBox()

  expect(core).not.toBeNull()
  expect(orbit).not.toBeNull()
  expect(criteria).not.toBeNull()
  expect(core!.y).toBeGreaterThanOrEqual(orbit!.y)
  expect(core!.y + core!.height).toBeLessThanOrEqual(orbit!.y + orbit!.height + 1)
  expect(core!.y + core!.height).toBeLessThanOrEqual(criteria!.y + 1)

  const categoryTiles = page.locator('.category-tile')
  for (let index = 0; index < await categoryTiles.count(); index += 1) {
    await categoryTiles.nth(index).focus()
    const contentOverflows = await page.locator('.match-core').evaluate((element) =>
      element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
    )
    expect(contentOverflows).toBe(false)
  }
})
