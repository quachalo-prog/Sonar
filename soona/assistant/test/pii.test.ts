import { test } from "node:test";
import assert from "node:assert/strict";
import { PiiRedactor, restore } from "../src/pii.js";

const r = new PiiRedactor();

test("emails, téléphones FR et internationaux", async () => {
  const { text, counts } = await r.redact("Écrivez à camille.durand@exemple.fr ou au 06 12 34 56 78, +33 6 12 34 56 78, 01.42.33.44.55, +44 20 7946 0958");
  assert.equal(text, "Écrivez à [EMAIL_1] ou au [TEL_1], [TEL_2], [TEL_3], [TEL_4]");
  assert.equal(counts.TEL, 4);
});

test("IBAN, carte et n° de sécu uniquement si la clé de contrôle est valide", async () => {
  const ok = await r.redact("IBAN FR76 3000 6000 0112 3456 7890 189, carte 4970 1012 3456 7893, sécu 1 85 05 78 006 084 91");
  assert.equal(ok.text, "IBAN [IBAN_1], carte [CARTE_1], sécu [NIR_1]");
  const ko = await r.redact("Commande 4970 1012 3456 7899 et IBAN FR76 3000 6000 0112 3456 7890 180");
  assert.doesNotMatch(ko.text, /\[(CARTE|IBAN)_/);
});

test("noms annoncés par un indice, civilités et signatures", async () => {
  const { text } = await r.redact("Bonjour, je m'appelle Camille Durand. Mon RDV avec Mme Leroy est décalé.\nCordialement, Jean-Pierre de la Fontaine");
  assert.equal(text, "Bonjour, je m'appelle [NOM_1]. Mon RDV avec Mme [NOM_2] est décalé.\nCordialement, [NOM_3]");
});

test("noms connus du profil, même sans indice, et liste blanche des pros publics", async () => {
  const { text } = await r.redact("Camille a réservé chez Me Sarah Cohen, DURAND est mon nom", { knownNames: ["Camille Durand"], publicNames: ["Me Sarah Cohen"] });
  assert.equal(text, "[NOM_1] a réservé chez Me Sarah Cohen, [NOM_2] est mon nom");
});

test("même valeur → même marqueur, et réhydratation", async () => {
  const red = await r.redact("a@b.fr puis A@B.fr puis c@d.fr");
  assert.equal(red.text, "[EMAIL_1] puis [EMAIL_1] puis [EMAIL_2]");
  assert.equal(restore("Je vous écris à [EMAIL_2]. Ancien : [NOM_7]", red.mapping), "Je vous écris à c@d.fr. Ancien : (information masquée)");
});

test("pas de faux positifs sur le texte courant", async () => {
  const s = "RDV le 14/10/2026 à 09:30, coupe 35€, réf. 123456, code postal 75004, Paris, Lyon. Je suis Parisienne. Merci !";
  assert.equal((await r.redact(s)).text, s);
});

test("un détecteur externe en échec ne bloque pas l'anonymisation", async () => {
  const broken = new PiiRedactor({ detectNames: async () => { throw new Error("réseau"); } });
  assert.equal((await broken.redact("mail : x@y.fr")).text, "mail : [EMAIL_1]");
});
