import type { ActionFunctionArgs } from 'react-router';

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await context.shopify.authenticate.webhook(request);
  console.log(`Received ${topic} for ${shop}`);

  if (session) {
    const current = payload.current as string[];
    await context.env.DB.prepare('UPDATE sessions SET scope = ? WHERE id = ?')
      .bind(current.toString(), session.id)
      .run();
  }

  return new Response();
};
