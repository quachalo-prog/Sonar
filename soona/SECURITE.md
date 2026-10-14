# Soona — Revue de sécurité et d'objectifs (v2.0 → v2.1)

Fichier revu : `soona-app.html` (v2.0). Version corrigée : `soona/index.html` (v2.1).

> ⚠️ **Limite de fond.** Soona est une application **100 % côté navigateur** : toutes les données sont dans le
> `localStorage` de l'appareil. Toute « règle » (mot de passe, droits, score, garantie) peut être contournée par
> quelqu'un qui ouvre les outils développeur. La v2.1 rend la démo saine et prépare le terrain, mais **une mise en
> production exige un backend** (voir la dernière section).

## 1. Failles corrigées

| # | Gravité | Problème (v2.0) | Correction (v2.1) |
|---|---------|-----------------|-------------------|
| 1 | 🔴 Critique | **XSS stockée** : nom, description, adresse, motif, avis… injectés tels quels via `innerHTML`. Un pro nommé `<img src=x onerror=…>` exécutait du code chez chaque client (vérifié). | Gabarit `html\`\`` qui **échappe toute valeur par défaut**. Plus aucun `onclick` inline : délégation d'événements + **liste blanche** d'actions. |
| 2 | 🔴 Critique | **Connexion sans mot de passe** : il suffisait de connaître l'email de quelqu'un. | Mot de passe obligatoire (8 car. min., mots de passe triviaux refusés), **haché PBKDF2-SHA256, 600 000 itérations, sel aléatoire**, comparaison à temps constant, message d'erreur générique, **verrouillage progressif après 5 échecs**. Les anciens comptes définissent leur mot de passe à la 1ʳᵉ connexion. |
| 3 | 🔴 Critique | **Faux formulaire bancaire** : numéro de carte et CVC saisis dans de simples champs, avec la mention « Paiement sécurisé par Stripe » (faux, et contraire à PCI-DSS). | Champs carte supprimés. Écran « mode démonstration » clair ; en production : Stripe Elements/Checkout (SetupIntent), Soona ne voit jamais la carte. |
| 4 | 🟠 Élevée | **Aucun contrôle d'accès** : n'importe qui pouvait annuler, marquer « honoré/absent » ou noter n'importe quel RDV. | Vérification du propriétaire à chaque action (client ↔ `clientId`, pro ↔ `proId`) et du mode actif. |
| 5 | 🟠 Élevée | **Session = objet utilisateur complet** dans `localStorage` (rôle, `proId` modifiables). | Session = `{uid, mode, expiration 7 j}` ; l'utilisateur est relu depuis la base. Migration automatique. |
| 6 | 🟠 Élevée | **Fraude au score de fiabilité** : laisser un avis passait le RDV en « honoré » (+10 pts) → le client contournait lui-même la garantie. | Seul le pro valide « honoré/absent », et seulement après l'heure du RDV. Avis **uniquement sur RDV honoré**, un seul par RDV. |
| 7 | 🟡 Moyenne | Double réservation possible (état de l'interface non revérifié), créneaux déjà passés réservables, dates hors fenêtre. | `finalizeBooking()` revérifie tout : créneau libre, non passé, dans les 14 jours, type autorisé, pas de chevauchement, max 5 RDV à venir. |
| 8 | 🟡 Moyenne | Pas de Content-Security-Policy. | CSP stricte : seul le script dont l'empreinte SHA-256 est déclarée s'exécute ; `connect-src 'none'`, `base-uri`/`form-action`/`object-src` verrouillés. Vérifié : une injection directe d'`onerror` est bloquée. |
| 9 | 🟡 Moyenne | Emails en double, aucune validation des saisies, pas de limite de longueur. | Email unique et normalisé, validation email/téléphone, `maxlength` + nettoyage des caractères de contrôle. Catégorie pro vérifiée par liste blanche. |
| 10 | 🟢 Faible | Le toast invisible bloquait les clics en bas d'écran ; données personnelles laissées dans le formulaire après déconnexion. | `pointer-events:none` ; formulaires vidés à la déconnexion. `no-referrer`. |

## 2. RGPD / confidentialité

- **Consentement** explicite à l'inscription, qui mentionne le **score de fiabilité** (profilage visible par les pros).
- **Exporter mes données** (JSON, sans l'empreinte du mot de passe) et **Supprimer mon compte** (RDV futurs annulés,
  nom anonymisé, avis supprimés, fiche pro retirée).
- Avis publiés avec le **prénom seulement**. Alerte sous le champ « motif » : pas de données de santé ou confidentielles.
- Le rôle « Patient » est renommé « Client » (les métiers proposés ne sont pas médicaux).
- À faire : héberger les polices localement (Google Fonts transmet l'IP des visiteurs à Google), rédiger la politique
  de confidentialité et le registre des traitements.

## 3. Objectifs métier — corrections

| Objectif | Problème (v2.0) | v2.1 |
|----------|-----------------|------|
| Réduire les absences | `needsDeposit()` existait mais **n'était jamais appelé** : seule la visio demandait une carte. | Garantie demandée en visio, pour un nouveau client (jusqu'au 1ᵉʳ RDV honoré) et si le score < 50. Raison affichée au client. |
| Score de fiabilité juste | Une annulation **par le pro** pénalisait le client ; tout nouveau client était affiché « ⚠️ Risque ». | Seules les annulations du client comptent : absence −30, annulation < 24 h −15, annulation anticipée −5, RDV honoré +10. Nouveau client = « Nouveau ». Avertissement avant une annulation tardive. Score visible par le client dans ses réglages. |
| Avis fiables | Note de 5,0 inventée pour chaque nouveau pro ; avis Soona ignorés dans la note affichée. | « Nouveau » tant qu'il n'y a pas d'avis ; note = moyenne pondérée historique + avis vérifiés. |
| Tableau de bord pro | « Taux de remplissage » calculait en réalité un taux de présence. | Vrai remplissage sur 7 jours (RDV / créneaux ouverts) + taux d'absences. |
| Pertinence | Visio proposée pour un garage ou un coiffeur. | Visio limitée à juridique, comptabilité, immobilier, bien-être. |
| Fiabilité des dates | Dates calculées en **UTC** (`toISOString`) : décalage d'un jour entre minuit et 2 h en France ; semaine fausse le dimanche. | Dates en heure locale partout. |
| Accessibilité | Cartes non focalisables au clavier, interrupteurs sans état. | Boutons/`role=button` focalisables, `aria-pressed`/`aria-checked`, focus visible, toast annoncé (`aria-live`). |

## 4. Avant la production (indispensable)

1. **Backend + base de données** (ex. Supabase/Firebase/API maison) : authentification serveur, et **toutes les règles
   ci-dessus réappliquées côté serveur** (droits, créneaux, score, avis). Le navigateur ne doit plus être la source de vérité.
2. **Paiement** : Stripe SetupIntent + Elements ; webhooks signés ; jamais de données carte chez Soona.
3. **En-têtes HTTP** : HTTPS + HSTS, CSP en en-tête (avec `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`,
   `Referrer-Policy`, `Permissions-Policy`.
4. Vérification de l'email (lien de confirmation), réinitialisation de mot de passe, limitation de débit côté serveur,
   journalisation des actions sensibles.

## Maintenance

La CSP autorise le script inline par son empreinte. **Après toute modification du `<script>`**, lancer :

```sh
node soona/tools/update-csp.mjs
```

Sinon le navigateur bloquera le script (page blanche).

## Vérification effectuée

Parcours automatisé avec Playwright (Chromium, écran mobile) : 32 contrôles OK, dont injections XSS dans le nom,
le motif et l'avis (aucune exécutée), refus des actions non autorisées, verrouillage après 5 échecs, garantie
exigée/levée selon la fiabilité, export et suppression RGPD, zéro erreur JS, zéro violation CSP.
