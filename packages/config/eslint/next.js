// Shared ESLint flat config for Next.js apps.
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';

/**
 * @param {{ tsconfigRootDir: string }} _options
 */
export function nextConfig(_options) {
  return tseslint.config(
    { ignores: ['.next/**', 'next-env.d.ts', 'dist/**'] },
    ...nextVitals,
    ...nextTs,
    {
      rules: {
        // Rich text must go through the sanitized component (see docs/SECURITY.md).
        'react/no-danger': 'error',
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@tahi/database', '@tahi/database/*'],
                message: 'Frontends must never access the database directly; call the API.',
              },
            ],
          },
        ],
      },
    },
  );
}
