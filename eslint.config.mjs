import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/next-env.d.ts',
      '**/src/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // docs/security.md section 4: only these folders may use a client without tenant scoping.
  {
    files: ['**/src/**/*.ts'],
    ignores: [
      '**/src/common/auth/**',
      '**/src/common/prisma/**',
      '**/src/modules/platform/**',
      '**/src/modules/health/**',
      '**/src/modules/public-sites/**',
      '**/src/modules/media/media-cleanup.job.ts',
      '**/*.spec.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/base-prisma.token'],
              message: 'Use the scoped client (SCOPED_PRISMA). See docs/security.md section 4.',
            },
            {
              group: ['**/generated/prisma/*', '**/prisma-clients'],
              allowTypeImports: true,
              message: 'Use the scoped client (SCOPED_PRISMA). See docs/security.md section 4.',
            },
          ],
        },
      ],
    },
  },
);
