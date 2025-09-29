const DEFAULT_RULE_KEY = 'visibility';
const DEFAULT_RULE_VALUE = 'public';

const envRuleKey = import.meta.env.VITE_INSTANTDB_MULTIPLAYER_RULE_KEY;
const envRuleValue = import.meta.env.VITE_INSTANTDB_MULTIPLAYER_RULE_VALUE;

const resolvedRuleKey = typeof envRuleKey === 'string' && envRuleKey.trim()
  ? envRuleKey.trim()
  : DEFAULT_RULE_KEY;

const resolvedRuleValue = typeof envRuleValue === 'string' && envRuleValue.trim()
  ? envRuleValue.trim()
  : DEFAULT_RULE_VALUE;

export const MULTIPLAYER_RULE_PARAMS = Object.freeze({
  [resolvedRuleKey]: resolvedRuleValue,
});

export function applyMultiplayerRuleParams(chunk) {
  if (!chunk || typeof chunk.ruleParams !== 'function') {
    return chunk;
  }
  const ops = Array.isArray(chunk.__ops) ? chunk.__ops : null;
  const alreadyApplied = Boolean(ops && ops.some((step) => step?.[0] === 'ruleParams'));
  const withRuleParams = alreadyApplied
    ? chunk
    : chunk.ruleParams(MULTIPLAYER_RULE_PARAMS);

  const finalOps = Array.isArray(withRuleParams?.__ops) ? withRuleParams.__ops : null;
  if (!finalOps) {
    return withRuleParams;
  }

  const ruleIndex = finalOps.findIndex((step) => step?.[0] === 'ruleParams');
  if (ruleIndex > 0) {
    const [ruleStep] = finalOps.splice(ruleIndex, 1);
    finalOps.unshift(ruleStep);
  }

  return withRuleParams;
}

