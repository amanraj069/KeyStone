import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * data/answer_key/ is the benchmark's answer key (AGENTS.md section 2). Only
 * src/bench/ may name it, and only the bench (src/bench/, scripts/bench.ts) may
 * import its reader; anything else fails lint. src/bench/answer-key-guard.spec.ts
 * checks the same for the whole repo, the web app included.
 */
const ANSWER_KEY_MESSAGE = 'Only the benchmark (src/bench/) may read data/answer_key/ (AGENTS.md section 2).';
const answerKeyPath = [
  { selector: 'Literal[value=/answer_key/]', message: ANSWER_KEY_MESSAGE },
  { selector: 'TemplateElement[value.raw=/answer_key/]', message: ANSWER_KEY_MESSAGE },
];
const answerKeyReader = [
  { selector: 'ImportDeclaration[source.value=/bench\\/answer-key/]', message: ANSWER_KEY_MESSAGE },
  { selector: 'ImportExpression[source.value=/bench\\/answer-key/]', message: ANSWER_KEY_MESSAGE },
];

export default tseslint.config(
  { ignores: ['dist/**', '*.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    ignores: ['src/bench/**', 'scripts/bench.ts'],
    rules: { 'no-restricted-syntax': ['error', ...answerKeyPath, ...answerKeyReader] },
  },
  {
    // The bench CLI may import the reader, but still not name the folder itself.
    files: ['scripts/bench.ts'],
    rules: { 'no-restricted-syntax': ['error', ...answerKeyPath] },
  },
);
