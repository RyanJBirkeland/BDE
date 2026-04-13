import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      '**/.claude/**',
      '**/worktrees/**',
      '**/release/**',
      '**/coverage/**',
      '**/test-results/**',
      'e2e/**'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      'no-restricted-exports': ['error', { restrictDefaultExports: { direct: true } }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ]
    }
  },
  // Relax strict type rules in test files — mocks legitimately need any and Function
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'require-yield': 'off'
    }
  },
  // Allow default exports in lazy-loaded views (React.lazy requires them) and config files
  {
    files: ['**/views/*.tsx', '**/vitest*.ts', '*.config.ts', '*.config.mjs'],
    rules: {
      'no-restricted-exports': 'off'
    }
  },
  // Require safeHandle channel name on same line as safeHandle( for reliable grep-based tooling
  {
    plugins: {
      local: {
        rules: {
          'safe-handle-channel-same-line': {
            meta: {
              type: 'suggestion',
              docs: {
                description: 'Require safeHandle channel name on same line as safeHandle('
              }
            },
            create(context) {
              return {
                CallExpression(node) {
                  if (
                    node.callee.type === 'Identifier' &&
                    node.callee.name === 'safeHandle' &&
                    node.arguments.length > 0
                  ) {
                    const callLine = node.loc.start.line
                    const firstArgLine = node.arguments[0].loc.start.line
                    if (callLine !== firstArgLine) {
                      context.report({
                        node: node.arguments[0],
                        message: "safeHandle channel name must be on the same line as 'safeHandle('"
                      })
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    files: ['src/main/**/*.ts'],
    rules: {
      'local/safe-handle-channel-same-line': 'error'
    }
  },
  eslintConfigPrettier
)
