# Keystone benchmark

Generated 2026-10-18T09:19:13.177Z with openai `gpt-5-nano` (judge `gpt-5-nano`, embeddings `openai/text-embedding-3-small`). LLM calls (all runs behind this file): at most 936 planned, 242 made, 341 answered from the cache.

## B2 · Question answering

Up to 30 questions per type, sampled with seed 13. Both systems use the same model and the same context budget of 60,000 characters: Keystone through its agent and MCP tools, the baseline with the top 75 vector-only chunks (Stage 6) pasted into one prompt until the budget is full. 78 of 78 questions have a yes/no-with-reason gold answer and were scored by a blinded LLM judge that sees the question, the gold answer and one candidate at a time, never which system wrote it.

Reference: always giving each type's most common gold answer would score 68% (hindsight; it knows the answer distribution). At least one system is above it.

Evidence recall (share of the answer key's evidence artifacts the system had in front of it): Keystone 53%, vector-only 17%.

Paired on the same 78 questions: only Keystone right on 42, only vector-only right on 5 (exact sign test p < 0.001: the gap is unlikely to be chance).

Answers that decline ("not in the company's records" or similar): Keystone 1 of 78, vector-only 27 of 78. A refusal is scored as wrong.

Keystone is slower: a median 5.9 s against 1.6 s (about 4x).

Accuracy with its 95% confidence interval (Wilson) in brackets.

| Question type | n | Keystone | Vector-only | Most common answer (hindsight) | Evidence recall K / V | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| COUNTERFACTUAL | 21 | 62% (41-79) | 14% (5-35) | 90% | 44% / 17% | Keystone ahead by 48 points. |
| PERSPECTIVE | 30 | 80% (63-90) | 27% (14-44) | 63% | 21% / 25% | Keystone ahead by 53 points. |
| SILENCE | 27 | 70% (52-84) | 30% (16-48) | 56% | 73% / 12% | Keystone ahead by 41 points. |
| **Overall** | 78 | 72% (61-81) | 24% (16-35) | 68% | 53% / 17% | Keystone ahead by 47 points. |

| System | Median latency (uncached answers) |
| --- | ---: |
| Keystone | 5.9 s |
| Vector-only | 1.6 s |

### Where the baseline wins or ties

Nowhere in this sample: Keystone is ahead on every question type.

Sample sizes are small (at most 30 per type), so a difference of one or two questions is within noise.

## B1 · Departure prediction

2 departures inside the simulated days with 5 gold domains: read these as worked examples, not as a score.

For each departure inside the simulated days, departure impact (K5, minScore 0.4) ran on a projection built as of the day before. Headline metric: the strict prediction — only the systems K5 says the person orphans (no backup left) — matched against the person's actual knowledge domains (normalised names from aliases.json, then fuzzy matching, then an LLM yes/no for leftover pairs). This is what the departure actually leaves uncovered.

| Person | Left on day | Orphaned (K5 backups = 0) | Gold domains | Precision | Recall | F1 |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| Jordan | 12 | — | auth-service, redis-cache, oauth2-flow | n/a | 0% | n/a |
| Morgan | 34 | ETL, React admin portal, ECS | kubernetes-deploy, terraform-infra | 0% | 0% | 0% |
| **Overall (micro)** | | | | 0% | 0% | 0% |

- K5 listed **no systems** for Jordan as of day 11: no core system where they met the expert rule, so recall is 0 and precision is undefined.
- K5 lists every core system where the person counts as an expert (22 for Morgan), not only the knowledge that leaves with them, so precision is low by construction. The stricter orphaned-only prediction is shown below.
- **None** of the pre-day-1 departures' domains shows up as orphaned or critical in bus factor today.

Broad prediction, for context (every system K5 counts the person as an expert on, not only what leaves with them — precision is low here by construction):

| Person | Left on day | Projection | Predicted (K5) | Gold domains | Matches | Precision | Recall | F1 |
| --- | ---: | --- | --- | --- | --- | ---: | ---: | ---: |
| Jordan | 12 | as of day 11 | — | auth-service, redis-cache, oauth2-flow | — | n/a | 0% | n/a |
| Morgan | 34 | as of day 33 | ETL, React admin portal, ECS, DynamoDB, Amazon, AWS IAM, Lambda, SNS, RDS, AWS Cost Explorer, API gateway, Terraform, CloudWatch, auth-service, CI/CD, AWS, VPC, IAM, Redis cache, Slack, S3, EKS | kubernetes-deploy, terraform-infra | terraform-infra = Terraform (exact) | 5% | 50% | 8% |
| **Overall (micro)** | | | | | | 5% | 20% | 7% |

A second predictor (not K5): systems, core or not, where the person holds at least a quarter of everyone's knowledge as of the day before, thread participation included:

| Person | Predicted (knowledge share) | Matches | Precision | Recall | F1 |
| --- | --- | --- | ---: | ---: | ---: |
| Jordan | — | — | n/a | 0% | n/a |
| Morgan | Transit Gateway, CloudTrail, ECS, ETL, React admin portal, IAM, VPC, DynamoDB | — | 0% | 0% | 0% |
| **Overall (micro)** | | | 0% | 0% | 0% |

Departures before day 1 (genesis gaps): do their domains show up as orphaned or critical in bus factor (K4) on apex_proj?

| Person | Day | Domains | Found as orphaned / critical | Recall |
| --- | ---: | --- | --- | ---: |
| Bill | -579 | TitanDB, legacy auth service, AWS cost structure, Project Titan | — | 0% |
| Sharon | -306 | mobile analytics, legacy auth service, AWS cost structure, Project Titan | — | 0% |
| **Overall** | | | 0 of 8 domains | 0% |

