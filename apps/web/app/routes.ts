import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('c/:conversationId', 'routes/home.tsx', { id: 'conversation' }),
  route('costs', 'routes/costs.tsx'),
] satisfies RouteConfig
