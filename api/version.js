// Vercel Serverless Function — expõe o identificador do deploy atual.
//
// VERCEL_GIT_COMMIT_SHA é injetada automaticamente pela Vercel em toda
// build, sem precisar manter nada manualmente. O front-end consulta essa
// rota periodicamente pra saber se um deploy novo já está no ar.
// Endpoint público de propósito — não expõe nada sensível, e precisa
// funcionar mesmo na tela de login (antes de o usuário se autenticar).

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  const version = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || 'dev';
  res.status(200).json({ version });
}
