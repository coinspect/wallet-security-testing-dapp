import { defineConfig, globalIgnores } from 'eslint/config';
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';
import a11y from 'eslint-plugin-jsx-a11y';
import imports from 'eslint-plugin-import';
import globals from 'globals';

export default defineConfig([
    globalIgnores(['dist/**', '.next/**', 'out/**', 'build/**']),
    {
        files: ['**/*.{js,jsx,mjs,cjs}'],
        plugins: { react, 'react-hooks': hooks, 'jsx-a11y': a11y, import: imports },
        languageOptions: {
            parserOptions: { ecmaFeatures: { jsx: true } },
            globals: { ...globals.browser, ...globals.node, __WSR_BUILD_PROVENANCE__: 'readonly' },
        },
        settings: { react: { version: 'detect' } },
        rules: {
            ...react.configs.recommended.rules,
            ...hooks.configs.recommended.rules,
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off',
            'react/no-unknown-property': 'off',
            'react/jsx-no-target-blank': 'off',
            'react-hooks/set-state-in-effect': 'off',
            'react-hooks/refs': 'off',
            'import/no-anonymous-default-export': 'warn',
            'jsx-a11y/alt-text': 'warn',
            'jsx-a11y/aria-props': 'warn',
            'jsx-a11y/aria-proptypes': 'warn',
            'jsx-a11y/aria-unsupported-elements': 'warn',
            'jsx-a11y/role-has-required-aria-props': 'warn',
            'jsx-a11y/role-supports-aria-props': 'warn',
        },
    },
]);
