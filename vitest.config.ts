import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node', // WebCrypto (crypto.subtle) está disponible en Node 20+
    include: ['src/**/*.test.ts'],
  },
})
