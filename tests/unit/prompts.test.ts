import { describe, it, expect } from 'vitest';
import {
  FLOW_PROMPTS,
  FLOW_READ_ACTIONS,
  FLOW_DO_ACTIONS,
  CREDIT_READ_ACTIONS,
  CREDIT_DO_ACTIONS,
  AUTH_ACTIONS,
} from '../../src/tools';

const ALL_ACTIONS = new Set<string>([
  ...FLOW_READ_ACTIONS,
  ...FLOW_DO_ACTIONS,
  ...CREDIT_READ_ACTIONS,
  ...CREDIT_DO_ACTIONS,
  ...AUTH_ACTIONS,
]);

describe('guided prompt templates', () => {
  it('every declared action exists in the dispatch action lists (drift guard)', () => {
    for (const prompt of FLOW_PROMPTS) {
      for (const action of prompt.actions) {
        expect(ALL_ACTIONS.has(action), `${prompt.name} references unknown action "${action}"`).toBe(true);
      }
    }
  });

  it('every declared action is actually mentioned in the template content', () => {
    for (const prompt of FLOW_PROMPTS) {
      for (const action of prompt.actions) {
        expect(prompt.content.includes(action), `${prompt.name} declares "${action}" but never uses it`).toBe(true);
      }
    }
  });

  it('prompt names are unique and non-empty', () => {
    const names = FLOW_PROMPTS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => n.length > 0)).toBe(true);
  });
});
