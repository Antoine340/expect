# Performance du serveur MCP en cours d'utilisation

Analyse mesurée du coût par appel d'outil, hors temps de démarrage (déjà traité :
`94cdfbd0` playwright paresseux, `78fdbabf` télémétrie retirée).

Statut : **analysé, non implémenté.** Mis de côté à la demande de l'utilisateur.

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

## Hypothèses invalidées par la mesure

- **Court-circuiter l'overlay en headless** : 0,2 ms par aller-retour CDP.
  Aucun gain, malgré 5 à 10 allers-retours par appel `playwright`.
- **Empreinte mémoire des screenshots** : 0,18 à 0,75 MB. Rien à optimiser.

## Plan retenu (non appliqué)

1. **Alléger la réponse snapshot** — retirer l'indentation de
   `safeJsonStringify`, ne plus envoyer `box` à l'agent (le garder dans le
   `RefMap` interne pour `annotatedScreenshot`), retirer `refs` de la réponse
   MCP, mettre `buildExpectGuide` à jour. Corriger `estimatedTokens` qui ne
   compte que l'arbre et sous-estime le coût réel d'un facteur ~4.
2. **Scinder `RUNTIME_SCRIPT`** en core (10 KB, toujours injecté) et overlay
   (442 KB, headed seulement). Effet secondaire : React et les polices cessent
   de polluer la page que `performance_metrics` mesure — l'observateur LCP
   contourne déjà notre propre overlay, la contamination est avérée.
3. **`boxes: true` uniquement quand nécessaire** — `SnapshotOptions.boxes`,
   défaut `false`, `annotatedScreenshot` le passe à `true`.
4. **Séparer lectures et écritures dans `prepareViewportSnapshot`** — collecter
   tous les rects avant d'appliquer les `visibility`.

Le point 1 change le contrat vu par l'agent : `refs` disparaît de la réponse.
Le guide dirige déjà l'agent vers les `[ref=eN]` de l'arbre.

## Références

- Limites de sortie MCP dans Claude Code : <https://code.claude.com/docs/en/mcp>
- Playwright MCP : <https://github.com/microsoft/playwright-mcp>
