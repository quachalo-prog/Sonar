# Soona — Rapport d'audit technique (v2.1 → v2.2)

**Fichier analysé :** `soona/index.html` v2.1 (version déjà sécurisée au tour précédent). Les numéros de ligne renvoient à cette version.
**Fichier corrigé :** `soona/index.html` v2.2 (1 225 lignes, 100 Ko, 29 Ko compressé en gzip).
**Méthode :** validateur `html-validate`, linter `stylelint`, audit d'accessibilité `axe-core` (WCAG 2 A/AA et bonnes pratiques) sur 12 écrans, rendu Chromium en 320 px, 390 px et 1 280 px, en clair, en sombre et en contraste élevé. 43 tests automatisés de bout en bout.

## Synthèse

| Contrôle | v2.1 | v2.2 |
|---|---|---|
| Balises (ouverture/fermeture, DOCTYPE, head, body) | ✅ bien formé | ✅ |
| Erreurs du validateur HTML (hors styles inline) | 46 | **0** |
| Violations axe (accessibilité) | 7 règles, 3 « serious/critical » | **0** |
| Erreurs JS à l'exécution | 0 | 0 |
| Débordement horizontal (320/390 px) | non | non |
| Tests de bout en bout | 31/31 | **43/43** |

**Problèmes trouvés : 3 critiques, 18 moyens, 14 mineurs.** Tous sont corrigés, sauf 2 qui se règlent hors du fichier (polices et icônes PWA, voir la fin du rapport).

> 🔴 Le plus grave : **le formulaire d'inscription restait affiché au-dessus de chaque écran une fois connecté**.
> Ce bug était déjà présent dans le fichier original (ligne 139). Voir `audit/avant-apres-ecran-inscription.png`.

---

## 1. Structure HTML

Le document est bien formé. Le DOCTYPE est présent, `<html lang="fr">` est déclaré, le head est complet (charset en premier, viewport, title) et toutes les balises sont correctement ouvertes et fermées. Aucune erreur d'imbrication n'a été trouvée.

| Ligne | Gravité | Problème | Correction |
|---|---|---|---|
| 224-225, 694, 775, 789 | Moyen | `<div>` dans un `<button>` (cartes de rôle, catégorie, type de RDV, jour) : HTML invalide, que les lecteurs d'écran annoncent mal. | Remplacés par des `<span>` en `display:block`. |
| 217 | Moyen | Aucun repère `<main>` : le contenu n'est pas balisé comme zone principale. | `<div class="app">` devient `<main class="app">`. |
| 379, 386 | Moyen | Deux `<nav>` sans nom accessible : on ne les distingue pas. | Ajout de `aria-label="Navigation client"` et `aria-label="Navigation pro"`. |
| 316, 359, 365, 265… | Moyen | Hiérarchie des titres incohérente : pas de `<h1>` sur la plupart des écrans, sauts h1→h3→h4. | Un `<h1>` par écran, puis des `<h2>` sans saut de niveau. |
| 227, 231, 235, 263, 275, 368 | Mineur | `<input>` sans attribut `type`. | Ajout de `type="text"`. |
| 233 | Mineur | `&` brut dans les `<option>` (« Esthétique & Beauté »). | Remplacé par `&amp;`. |
| 235 | Mineur | `autocomplete="street-address"` est réservé aux `<textarea>`. | Remplacé par `autocomplete="address-line1"`. |
| 283 et suivantes (25 occurrences) | Mineur | `<button>` sans `type` : risque d'envoi involontaire d'un formulaire. | Ajout de `type="button"` partout. |
| 284 | Mineur | `<h2 id="cat-title">` vide au chargement. | Texte par défaut « Catégorie ». |
| 13 | Mineur | Pas de `meta description`, pas de favicon (requête 404), pas de `<noscript>` (page blanche sans JS). | Les trois ont été ajoutés. Le favicon est un SVG inline, autorisé par la CSP. |

## 2. Rendu visuel

Aperçus : `audit/apercu.png` (5 écrans) et `audit/avant-apres-ecran-inscription.png`.

| Ligne | Gravité | Problème | Correction |
|---|---|---|---|
| **142** | 🔴 **Critique** | `.onboard{display:flex}` est déclaré après `.screen{display:none}` avec la même spécificité. **L'écran d'inscription reste visible au-dessus de l'accueil, du profil, de la réservation et du tableau de bord.** C'était déjà le cas dans l'original. | `.onboard:not(.active){display:none}`. |
| 126 | Moyen | Le bouton flottant « Aa » (en bas à droite) recouvrait des boutons d'action, par exemple « Simuler l'enregistrement et confirmer ». | Déplacé en haut à droite, dans une zone vide des en-têtes. |
| 753 | Mineur | Les créneaux affichés sur la fiche pro ressemblaient à des boutons (curseur main, survol) mais ne réagissaient pas. | Classe `slot-static`, sans effet de survol. |
| 514 | Mineur | « Bonjour Me 👋 » : le titre « Me » était pris pour le prénom. | `firstName()` ignore Me, Dr, M., Mme, Pr. |

## 3. JavaScript

Le code ne contient pas de fonction morte : toutes les fonctions sont appelées. Aucune erreur ne s'est produite à l'exécution. Les bugs trouvés sont les suivants.

| Ligne | Gravité | Problème | Correction |
|---|---|---|---|
| **1111** | 🔴 **Critique** | « Contraste élevé » force le texte en `#000`, **même en mode sombre** : texte noir sur fond noir, illisible. | Classe `.hc` dont les couleurs dépendent du thème : noir en clair, blanc en sombre. |
| **462** | 🔴 **Critique** | Le helper `html\`\`` affichait `false` comme une chaîne vide. Résultat : `aria-checked=""` et `aria-pressed=""` sont invalides (règle axe *aria-required-attr*, niveau critique), et l'état des interrupteurs n'est pas annoncé. | Les booléens s'affichent maintenant `"true"` ou `"false"`. |
| 1114 | Moyen | Mode sombre : quand le système est en sombre, l'interrupteur affichait « désactivé » et **le premier clic ne faisait rien**. | `isDark()` lit le thème réellement affiché ; l'interrupteur se synchronise aussi quand le système change de thème. |
| 674 | Moyen | Le bouton « retour » du navigateur ou d'Android quittait l'application au lieu de revenir à l'écran précédent. | Intégration de `history.pushState` / `popstate`, synchronisée avec la flèche ← de l'app. |
| 1001 | Mineur | Agenda pro un dimanche : le jour courant était absent de la liste. | Le jour courant est toujours affiché. |
| 631 | Mineur | Après l'inscription, le formulaire gardait nom, email et téléphone dans le DOM. | `form.reset()` après la création du compte. |

## 4. CSS

Aucune propriété n'est cassée. La seule propriété non standard, `-webkit-font-smoothing` (ligne 34), est sans effet hors macOS ; elle est conservée.

| Ligne | Gravité | Problème | Correction |
|---|---|---|---|
| 34 + tout le fichier | Moyen | Les tailles de texte sont en `px` : le réglage « Taille du texte » ne changeait que quelques éléments. | Toutes les `font-size` sont en `rem`, avec `html{font-size:var(--fs)}`. Mesure : 14 px → 19,25 px partout. |
| 200-208 | Moyen | 6 sélecteurs en double (`.cat-card`, `.slot`, `.setting-item`…), avec des spécificités inversées : le résultat dépendait de l'ordre de déclaration. | Les doublons sont fusionnés dans les règles d'origine. |
| 53-55, 167-171 | Moyen | Les variantes sombres des badges et de la bannière ne s'appliquaient qu'au thème sombre choisi manuellement, pas au thème sombre du système. | Ajout du bloc `@media (prefers-color-scheme: dark)`. |
| 62 | Moyen | Les animations ignoraient `prefers-reduced-motion`, ce qui gêne les personnes sensibles au mouvement. | Animations désactivées si l'utilisateur l'a demandé. |
| 59, 142 | Mineur | `min-height:100vh` est trop haut sur mobile à cause de la barre d'URL. | Ajout de `100dvh`, en gardant `100vh` en repli. |
| 55, 100, 177-178 | Mineur | CSS mort : `.badge-deal`, `.slot.disabled`, `.stripe-row`. | Supprimé. |

## 5. Liens et ressources

| Ligne | Gravité | Constat |
|---|---|---|
| 16 | — | Google Fonts : seule ressource externe. URL valide, `preconnect` en place. Si elle ne charge pas (hors ligne, réseau bloqué), l'app reste lisible grâce à la police de repli `sans-serif` (vérifié). |
| — | — | **Aucune image** et aucun chemin local : les icônes sont en emoji et en SVG inline. Aucun lien mort. Les liens `href="#"` sont interceptés en JS (`preventDefault`). |
| 13 | (déjà compté) | Favicon absent : le navigateur demandait `/favicon.ico` (404). Corrigé (voir section 1). |
| 6-8 | Mineur | Métadonnées PWA (`apple-mobile-web-app-capable`) sans `manifest` ni icônes : l'installation sur l'écran d'accueil n'est que partielle. **Non corrigé** : les icônes présentes dans le dépôt sont celles de Sonar. Il faut des icônes Soona. |

## 6. Responsive et accessibilité

Le responsive est bon. Il n'y a pas de débordement horizontal à 320 px ni à 390 px. Sur bureau, l'app est centrée sur 480 px de large et le zoom n'est pas bloqué.

| Ligne | Gravité | Problème | Correction |
|---|---|---|---|
| 22 (+ 30-31) | Moyen | Contraste insuffisant (WCAG AA) sur **12 écrans** : `--text3` à 3,17:1, liens corail à 2,64:1, texte blanc sur filtres corail à 2,82:1. | `--text3` passe à #6B6B80 (4,88:1) en clair et à #9494AC (5,0:1) en sombre. Ajout de `--accent` #C93A1B (5,12:1 avec le blanc). |
| 40, 98, 105, 118 | Moyen | Texte blanc sur le dégradé corail-rose-ambre (jusqu'à 2,35:1 sur l'ambre). | `--grad-strong` pour les boutons et cellules à texte blanc (≥ 5:1). Le dégradé d'origine est conservé pour le logo. |
| 86 | Moyen | Note ★ en ambre #FF8A3D sur fond clair : 2,2:1. | `--amber-text` #B45309 (4,71:1). |
| 1015 | Moyen | Créneaux libres de l'agenda en `opacity:.6` : 3,97:1. | Bordure en pointillés à la place de l'opacité. |
| 1057 | Mineur | « Se déconnecter » en rouge #EF4444 : 3,76:1. | `--danger-text` #B91C1C. |
| 261 | Moyen | Barre de recherche de l'accueil : un `<input>` à l'intérieur d'un `role="button"`, soit un élément interactif imbriqué. | Remplacée par un vrai `<button>`. |
| — | ✅ | Déjà en place : libellés `<label for>`, ordre de tabulation, focus visible, `aria-live` sur les notifications, cibles tactiles ≥ 44 px dans la navigation. | — |

## 7. Performance

| Ligne | Gravité | Problème | Correction |
|---|---|---|---|
| 476 | Moyen | `localStorage` est relu et re-parsé (`JSON.parse`) **à chaque accès**. Une liste de 15 pros déclenche environ 45 parsings, le tableau de bord encore plus : le coût augmente vite avec le nombre de RDV. | Cache mémoire invalidé à chaque écriture et lors de l'événement `storage` (autre onglet). |
| 16 | Moyen | Google Fonts : feuille de style bloquante et 2 familles, plusieurs graisses. C'est la seule requête externe, et elle transmet l'adresse IP des visiteurs à Google (point RGPD). | `display=swap` est déjà présent. **À faire en production :** héberger les polices localement en `woff2` et précharger celle des titres. |
| — | — | Poids total : 100 Ko non compressés, 29 Ko en gzip, en un seul fichier, sans image ni bibliothèque. Les 600 000 itérations PBKDF2 tournent dans WebCrypto, hors du thread principal (l'interface affiche « Connexion… »). | Rien à corriger. |

## Points restants (hors fichier)

1. **Styles inline (30 avertissements du validateur, non corrigés).** Ils viennent du code d'origine. Ils sont autorisés par la CSP (`style-src 'unsafe-inline'`) et ne posent pas de problème de sécurité. Les déplacer dans des classes CSS améliorerait la maintenance.
2. **PWA :** créer un `manifest` et des icônes propres à Soona (voir section 5).
3. **Polices :** les héberger localement (voir section 7).
4. **Maintenance :** après toute modification du `<script>`, relancer `node soona/tools/update-csp.mjs`. Sinon la CSP bloque le script.
