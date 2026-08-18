# Performance du serveur MCP en cours d'utilisation

Analyse mesurée du coût par appel d'outil, hors temps de démarrage (déjà traité :
`94cdfbd0` playwright paresseux, `78fdbabf` télémétrie retirée).

Statut : points 1 et 2 **appliqués** (`b4606435`, `e025c756`), points 3 et 4 en
attente.

> **Correction.** Les chiffres de payload ci-dessous ont d'abord été obtenus en
> simulant le pipeline hors du serveur. Mesurés à travers le vrai serveur MCP,
> ils étaient plus bas — parce que `safeJsonStringify` tronquait silencieusement
> l'arbre à 10 000 caractères. Voir « Troncature silencieuse » plus bas.

## Méthode

Chromium headless 1.61.1, macOS arm64, sites réels (`news.ycombinator.com`,
`github.com/microsoft/playwright`, `playwright.dev/docs/intro`) plus une page
synthétique de 2 000 lignes avec conteneur scrollable et 3 iframes. Médiane sur
8 itérations. Scripts de mesure jetables, supprimés après relevé.

## Mesures

| poste | mesure | verdict |
| --- | --- | --- |
| payload snapshot MCP (news.ycombinator) | 30 012 tok → 14 271 tok en arbre seul | -52 % |
| payload snapshot (github.com/microsoft/playwright) | 25 351 tok → 13 763 tok | -46 % |
| payload snapshot (playwright.dev/docs) | 15 941 tok → 8 326 tok | -48 % |
| `JSON.stringify(_, _, 2)` | +21–24 % sur chaque réponse JSON | déchet pur |
| `box` dans `refs` | +8–14 % | un seul consommateur interne (`browser.ts:407`) |
| carte `refs` | +19–24 % | 515 refs testés, 0 non reconstructible depuis `tree` |
| `RUNTIME_SCRIPT` injecté par frame | 452 KB dont 442 KB d'overlay React + CSS polices inlinées | +1,6 MB de heap par isolate, ~4 ms/navigation |
| `ariaSnapshot` `boxes:true` vs sans | 74,5 vs 68,7 ms | -8 % quand les boxes ne servent pas |
| `prepareViewportSnapshot` + restore | 6,4 ms | lectures/écritures entrelacées |
| parsing Node (10 914 lignes) | 3,7 ms | pas un goulot |
| aller-retour `page.evaluate` | 0,2 ms | — |
| screenshot fullPage en base64 | 0,18–0,75 MB | — |

## Constat principal

Le coût dominant n'est pas le CPU mais la taille de la réponse renvoyée à
l'agent. La documentation Claude Code fixe un avertissement à 10 000 tokens et
une limite dure par défaut à 25 000 (`MAX_MCP_OUTPUT_TOKENS`). Sur GitHub et
Hacker News, `screenshot mode=snapshot` dépasse cette limite aujourd'hui : la
réponse est tronquée. C'est un défaut fonctionnel, pas seulement une lenteur.

Playwright MCP ne renvoie que l'arbre avec les refs inline, sans carte
parallèle — ce qui confirme la redondance de notre champ `refs`.

## Troncature silencieuse de l'arbre (découverte à la vérification)

`safeJsonStringify` coupe toute chaîne dépassant `MAX_STRINGIFY_LENGTH`
(10 000 caractères). Ce garde-fou vise les valeurs arbitraires renvoyées par le
code `playwright`, mais il s'appliquait aussi à l'arbre du snapshot. Sur
`news.ycombinator.com`, l'agent recevait 10 000 caractères sur ~55 000, coupés
au milieu d'un nœud, pendant que `stats` annonçait la taille complète.

Mesures réelles à travers le serveur MCP, avant → après `b4606435` :

| site | avant (arbre coupé) | après (arbre complet) |
| --- | --- | --- |
| news.ycombinator.com | 18 503 tok | 14 298 tok |
| github.com/microsoft/playwright | 14 229 tok | 13 272 tok |
| playwright.dev/docs/intro | 10 603 tok | 8 388 tok |

Les trois passent sous la limite dure de 25 000 tokens ; les deux premiers
restent au-dessus du seuil d'avertissement de 10 000, ce qui plaide pour
exposer `depth` au tool `screenshot`.

`stats.estimatedTokens` ne mesurait que l'arbre. Une fois `refs` et
l'indentation retirés, il tombe à 4 % du payload réel — aucune correction
nécessaire.

## Hypothèses invalidées par la mesure

- **Court-circuiter l'overlay en headless** : 0,2 ms par aller-retour CDP.
  Aucun gain, malgré 5 à 10 allers-retours par appel `playwright`.
- **Empreinte mémoire des screenshots** : 0,18 à 0,75 MB. Rien à optimiser.

## Plan

1. ~~**Alléger la réponse snapshot**~~ — fait dans `b4606435` : arbre exempté de
   la troncature, `refs` retiré de la réponse MCP (conservé dans
   `SnapshotResult` pour `annotatedScreenshot`), indentation retirée des
   réponses mais conservée pour le fichier résultat que l'agent grep.
2. ~~**Scinder `RUNTIME_SCRIPT`**~~ — fait dans `e025c756` : core 9,9 KB toujours
   injecté, overlay 435,7 KB headed seulement. Mesuré en headless sur une page à
   cinq frames : 445,6 KB → 9,9 KB injectés par frame, heap 3,82 → 2,40 MB,
   navigation médiane 12,3 → 9,4 ms. React et les polices ne polluent plus la
   page que `performance_metrics` mesure.
3. **`boxes: true` uniquement quand nécessaire** — `SnapshotOptions.boxes`,
   défaut `false`, `annotatedScreenshot` le passe à `true`.
4. **Séparer lectures et écritures dans `prepareViewportSnapshot`** — collecter
   tous les rects avant d'appliquer les `visibility`.

Le point 1 change le contrat vu par l'agent : `refs` disparaît de la réponse.
Le guide dirige déjà l'agent vers les `[ref=eN]` de l'arbre.

## Références

- Limites de sortie MCP dans Claude Code : <https://code.claude.com/docs/en/mcp>
- Playwright MCP : <https://github.com/microsoft/playwright-mcp>
