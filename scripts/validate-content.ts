import {
  itmoKnowledgeDocuments,
  onboardingFlow,
  itmoSources,
  itmoStepDefinitions,
  itmoUniversityConfig,
  commonKnowledgeDocuments,
  commonSources,
  commonStepDefinitions,
  directoryKnowledgeDocuments,
  directorySources,
  directoryStepDefinitions,
  universityConfigs,
  universityDirectory,
} from '@first30/config';
import { validateContent } from '@first30/domain';
import { dictionaries } from '@first30/i18n';

const legacyIssues = validateContent({
  university: itmoUniversityConfig,
  sources: itmoSources,
  steps: itmoStepDefinitions,
  knowledgeDocuments: itmoKnowledgeDocuments,
  onboarding: onboardingFlow,
  dictionaries,
});
const directoryIssues = universityDirectory.flatMap((entry) => {
  const prefix = `uni_${entry.code.toLowerCase()}_`;
  const sources = [
    ...commonSources,
    ...directorySources.filter((source) => source.id.startsWith(prefix)),
    ...(entry.code === 'ITMO' ? itmoSources : []),
  ];
  const steps = [
    ...commonStepDefinitions,
    ...directoryStepDefinitions.filter((step) => step.universityCode === entry.code),
    ...(entry.code === 'ITMO' ? itmoStepDefinitions : []),
  ];
  const knowledgeDocuments = [
    ...commonKnowledgeDocuments,
    ...directoryKnowledgeDocuments.filter((document) => document.sourceId.startsWith(prefix)),
    ...(entry.code === 'ITMO' ? itmoKnowledgeDocuments : []),
  ];
  return validateContent({
    university: universityConfigs[entry.code]!,
    sources,
    steps,
    knowledgeDocuments,
    onboarding: onboardingFlow,
    dictionaries,
    mode: 'directory',
  }).map((issue) => ({ ...issue, path: `${entry.code}.${issue.path}` }));
});
const issues = [...legacyIssues, ...directoryIssues];
if (issues.length) {
  for (const issue of issues) console.error(`${issue.code} ${issue.path}: ${issue.message}`);
  process.exitCode = 1;
} else {
  console.info(
    `Content is valid: ${universityDirectory.length} universities, ${itmoStepDefinitions.length + commonStepDefinitions.length + directoryStepDefinitions.length} step definitions, ${itmoSources.length + commonSources.length + directorySources.length} sources`,
  );
}
