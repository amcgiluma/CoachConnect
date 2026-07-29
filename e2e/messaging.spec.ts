import { expect, test } from '@playwright/test'

const consumerEmail = process.env.COACHCONNECT_E2E_CONSUMER_EMAIL
const testPassword = process.env.COACHCONNECT_E2E_PASSWORD

test('persiste mensajes reales y ofrece regreso a la cuenta', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1280', 'El flujo remoto se ejecuta una sola vez')
  test.skip(!consumerEmail || !testPassword, 'Requiere credenciales de las cuentas sembradas')

  await page.goto('/')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.getByLabel('Email').fill(consumerEmail!)
  await page.getByLabel('Contraseña').fill(testPassword!)
  await page.getByRole('dialog').getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('link', { name: 'Mi cuenta' })).toBeVisible()

  await page.goto('/mensajes')
  await expect(page.getByRole('link', { name: 'Volver a mi cuenta' })).toBeVisible()
  await expect(page.getByText('Marta Entrenadora', { exact: true }).first()).toBeVisible()

  const message = `Persistencia E2E ${Date.now()}`
  await page.getByLabel('Mensaje').fill(message)
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect(page.locator('.message', { hasText: message })).toContainText(message)
  await page.reload()
  await expect(page.locator('.message', { hasText: message })).toContainText(message)
})
