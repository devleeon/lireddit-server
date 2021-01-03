export async function sendEmail(to: string, html: string) {
  var API_KEY = "45dc5fa8fc9bb08c854e45f0ef49447f-cb3791c4-3b89518d";
  var DOMAIN = "sandbox1e51976aec3648eda17d3d406d16d557.mailgun.org";
  var mailgun = require("mailgun-js")({ apiKey: API_KEY, domain: DOMAIN });

  const data = {
    from: "Lireddit<me@samples.mailgun.org>",
    to,
    subject: "Hello",
    html,
  };

  const transporter = await mailgun
    .messages()
    .send(data, (error: any, body: any) => {
      console.log(error);
      console.log(body);
    });

  console.log(transporter);
}
