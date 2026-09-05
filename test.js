(async () => {
  const res = await fetch(`https://app.jalpi.com/api/v1/sendTemplateMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: "e0a34525e6b245839adf26d692c3f231",
      to: "919769785721",
      languageCode: "en",
      TemplateName: "sos_order",
      BodyParameter: [
        { type: "text", text: "#: 999 | Screen #: 1 | Seat #: I3" },
        { type: "text", text: "Noida" },
      ],
    }),
  });
  console
    .log("HTTP", res.status, "\nSUCCESS BODY:", await res.text())
    .slice(0, 1500);
})().catch((e) => console.log("TRANSPORT ERROR:", redact(e.message)));
