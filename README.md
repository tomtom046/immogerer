# ImmoGérer — Gestion locative

Application web de suivi d'un appartement en location : loyers, charges, travaux, rentabilité, régularisation des charges, quittances PDF et envoi par Gmail.

Site statique (HTML/CSS/JavaScript, sans étape de compilation). Les données sont stockées dans **Firebase Firestore**, propres à chaque utilisateur.

## Fonctionnalités

- **Tableau de bord** : loyers encaissés, charges, travaux, bénéfice net après crédit, cash-flow, rentabilité brute et nette, graphique annuel.
- **Calendrier** des opérations.
- **Bail & locataire** : bailleur, locataire, loyer, charges, caution, prix d'achat, crédit, signature.
- **Finances** : saisie, modification, duplication, récurrence mensuelle, export CSV, sauvegarde et restauration JSON.
- **Régularisation des charges** : provisions perçues comparées aux charges réelles.
- **Quittances PDF** : uniquement pour les mois dont le loyer est encaissé, avec un reçu partiel si le paiement est incomplet.
- **Gmail** : envoi des quittances et des relances.

## Structure

```
index.html        Page et interface
css/style.css     Styles complémentaires (le reste vient de Tailwind)
js/app.js         Logique de l'application (Firebase, calculs, PDF, Gmail)
firestore.rules   Règles de sécurité à publier dans Firebase
.nojekyll         Indique à GitHub Pages de servir les fichiers tels quels
```

## Mise en ligne avec GitHub Pages

1. Envoyez ces fichiers dans un dépôt GitHub public.
2. Dans le dépôt, ouvrez **Settings > Pages**, puis choisissez **Deploy from a branch**, la branche `main` et le dossier `/ (root)`.
3. Le site est publié à l'adresse `https://<pseudo>.github.io/<depot>/`.

## Configuration Firebase (à faire une fois)

Dans la [console Firebase](https://console.firebase.google.com), projet `suivie-apartement` :

1. **Authentication > Sign-in method** : activez **Google**. Laissez **Anonyme** activé.
2. **Authentication > Settings > Domaines autorisés** : ajoutez `<pseudo>.github.io`.
3. **Firestore Database > Règles** : collez le contenu de [`firestore.rules`](firestore.rules), puis cliquez sur **Publier**.

> La clé `apiKey` présente dans `js/app.js` est publique par conception : c'est un identifiant, pas un secret. Ce qui protège les données, ce sont les règles Firestore ; ne les laissez jamais ouvertes.

## Configuration Gmail (facultatif)

Dans [Google Cloud](https://console.cloud.google.com), ouvrez **API et services > Identifiants**, puis votre ID client OAuth 2.0. Dans **Origines JavaScript autorisées**, ajoutez `https://<pseudo>.github.io`. Saisissez ensuite l'ID client dans l'onglet **Bail & Locataire** de l'application.

## Tester en local

Les modules JavaScript et la connexion Google ne fonctionnent pas si vous ouvrez le fichier directement (`file://`). Lancez plutôt un petit serveur depuis le dossier :

```
npx serve .
```

ou

```
python -m http.server 8000
```

Ouvrez ensuite `http://localhost:8000`. Pour utiliser la connexion Google en local, ajoutez `localhost` aux domaines autorisés de Firebase (il y est souvent déjà par défaut).

## Sauvegarde

Pensez à télécharger régulièrement une **Sauvegarde JSON** depuis l'onglet Finances. Le bouton **Importer JSON** permet de la restaurer.
