// Client navigateur minimal pour Soona : envoie un message, affiche la réponse,
// et renvoie le 👍 / 👎 (+ correction) à l'API. Aucune clé d'API ici : seul le jeton
// de session de l'utilisateur (Supabase Auth) est envoyé, et le serveur fait le reste.
//
// Côté Soona, ajouter l'origine de l'API dans la CSP : connect-src https://api.soona.example.fr
// puis relancer node soona/tools/update-csp.mjs si ce code est collé dans le <script> inline.

export function createAssistantClient({ baseUrl, getAccessToken }) {
  let conversationId = null;

  async function call(path, { method = "POST", body } = {}) {
    const res = await fetch(`${baseUrl}/api/assistant${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${await getAccessToken()}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data;
  }

  return {
    /** Envoie un message ; la conversation est suivie automatiquement. */
    async send(message) {
      const out = await call("/chat", { body: { message, ...(conversationId ? { conversationId } : {}) } });
      conversationId = out.conversationId;
      return out; // { reply, messageId, refused, memory }
    },
    /** rating : 1 (👍) ou -1 (👎) ; correction : texte libre facultatif. */
    rate: (messageId, rating, correction) => call("/feedback", { body: { messageId, rating, ...(correction ? { correction } : {}) } }),
    newConversation() { conversationId = null; },
    exportMyData: () => call("/memory", { method: "GET" }),
    forgetMe: () => call("/memory", { method: "DELETE" }),
  };
}

// Exemple d'affichage d'une réponse avec ses boutons de feedback (textContent : jamais d'innerHTML)
export function renderReply(container, client, { reply, messageId }) {
  const bubble = document.createElement("div");
  bubble.className = "assistant-bubble";
  bubble.textContent = reply;
  if (messageId) {
    const bar = document.createElement("div");
    for (const [label, rating] of [["👍", 1], ["👎", -1]]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("aria-label", rating === 1 ? "Réponse utile" : "Réponse à améliorer");
      b.addEventListener("click", async () => {
        const correction = rating === -1 ? prompt("Quelle aurait été la bonne réponse ? (facultatif)") : null;
        await client.rate(messageId, rating, correction || undefined);
        bar.textContent = "Merci pour votre retour !";
      });
      bar.append(b);
    }
    bubble.append(bar);
  }
  container.append(bubble);
}
