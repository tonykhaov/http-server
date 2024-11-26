/*
 * @adonisjs/http-server
 *
 * (c) AdonisJS
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import 'reflect-metadata'
import supertest from 'supertest'
import { Socket } from 'node:net'
import { test } from '@japa/runner'
import { Emitter } from '@adonisjs/events'
import type { NextFn } from '@poppinss/middleware/types'
import { AppFactory } from '@adonisjs/application/factories'
import { createServer, IncomingMessage, ServerResponse } from 'node:http'

import { Router } from '../src/router/main.js'
import { HttpContext } from '../src/http_context/main.js'
import { ServerFactory } from '../factories/server_factory.js'
import { defineNamedMiddleware } from '../src/define_middleware.js'
import { HttpRequestFinishedPayload, HttpServerEvents } from '../src/types/server.js'

const BASE_URL = new URL('./app/', import.meta.url)

test.group('Server', () => {
  test('get router instance used by the server', ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    server.use([])

    assert.instanceOf(server.getRouter(), Router)
  })

  test('store http server instance', ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    server.use([])

    const httpServer = createServer(() => {})
    server.setNodeServer(httpServer)

    assert.strictEqual(server.getNodeServer(), httpServer)
  })

  test('emit request finished route handler', async ({ assert }, done) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const emitter = new Emitter<HttpServerEvents>(app)
    const server = new ServerFactory().merge({ app, emitter }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    server.use([])
    server.getRouter().get('/', async ({ response }) => response.send('handled'))
    await server.boot()

    emitter.on('http:request_completed', (event: HttpRequestFinishedPayload) => {
      assert.instanceOf(event.ctx, HttpContext)
      assert.isArray(event.duration)
      done()
    })

    await supertest(httpServer).get('/').expect(200)
  }).waitForDone()
})

test.group('Server | Response handling', () => {
  test('invoke router handler', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    server.use([])
    server.getRouter().get('/', async ({ response }) => response.send('handled'))
    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(200)
    assert.equal(text, 'handled')
  })

  test('use route handler return value when response.send is not called', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    server.use([])
    server.getRouter().get('/', async () => 'handled')
    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(200)
    assert.equal(text, 'handled')
  })

  test('use route handler return value when handler is not async', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    server.use([])
    server.getRouter().get('/', () => 'handled')
    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(200)
    assert.equal(text, 'handled')
  })

  test('use route handler return value when middleware does not return it', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    server.use([])
    server
      .getRouter()
      .get('/', async () => 'handled')
      .middleware(async (_, next) => {
        await next()
      })

    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(200)
    assert.equal(text, 'handled')
  })

  test('use route handler return value when server middleware does not return it', async ({
    assert,
  }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    server.use([
      async () => {
        return {
          default: class GlobalMiddleware {
            async handle(_: HttpContext, next: NextFn) {
              await next()
            }
          },
        }
      },
    ])

    server.getRouter().get('/', async () => 'handled')

    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(200)
    assert.equal(text, 'handled')
  })

  test('do not use return value when response.send is called', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    server.use([])
    server.getRouter().get('/', async ({ response }) => {
      response.send('handled')
      return 'done'
    })
    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(200)
    assert.equal(text, 'handled')
  })

  test('redirect to given route', async ({ assert }) => {
    assert.plan(2)

    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    server.use([])
    server
      .getRouter()!
      .get('/guides/:doc', async ({ params }) => {
        assert.deepEqual(params, { doc: 'introduction' })
      })
      .as('guides')

    server.getRouter().on('/docs/:doc').redirect('guides')
    await server.boot()

    const { redirects } = await supertest(httpServer).get('/docs/introduction').redirects(1)

    assert.deepEqual(
      redirects.map((url) => new URL(url).pathname),
      ['/guides/introduction']
    )
  })

  test('redirect to given path', async ({ assert }) => {
    assert.plan(2)

    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    server.use([])
    server
      .getRouter()!
      .get('/guides/:doc', async ({ params }) => {
        assert.deepEqual(params, { doc: 'introduction' })
      })
      .as('guides')

    server.getRouter().on('/docs/:doc').redirectToPath('/guides/introduction')
    await server.boot()

    const { redirects } = await supertest(httpServer).get('/docs/introduction').redirects(1)
    assert.deepEqual(
      redirects.map((url) => new URL(url).pathname),
      ['/guides/introduction']
    )
  })

  test('invoke a domain specific router handler', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    server.use([])

    server
      .getRouter()!
      .get('/', async ({ response }) => response.send('handled'))
      .domain(':tenant.adonisjs.com')

    await server.boot()

    const { text } = await supertest(httpServer)
      .get('/')
      .set('X-Forwarded-Host', 'blog.adonisjs.com')
      .expect(200)

    assert.equal(text, 'handled')
  })

  test('return 404 when route for a top level domain does not exists', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    server.use([])

    server
      .getRouter()!
      .get('/', async ({ response }) => response.send('handled'))
      .domain(':tenant.adonisjs.com')

    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(404)
    assert.equal(text, 'Cannot GET:/')
  })

  test('redirect to a route using route.redirect method', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    server.use([])

    server.getRouter().get('/dashboard', () => 'dashboard')
    server.getRouter().on('/').redirect('/dashboard')

    await server.boot()

    const { status, headers } = await supertest(httpServer).get('/')
    assert.equal(status, 302)
    assert.equal(headers.location, '/dashboard')
  })

  test('redirect to a path using route.redirectToPath method', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    server.use([])

    server.getRouter().on('/').redirectToPath('/dashboard')

    await server.boot()

    const { status, headers } = await supertest(httpServer).get('/')
    assert.equal(status, 302)
    assert.equal(headers.location, '/dashboard')
  })

  test('redirect to a route with custom status code', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    server.use([])

    server.getRouter().get('/dashboard', () => 'dashboard')
    server.getRouter().on('/').redirect('/dashboard', {}, { status: 301 })

    await server.boot()

    const { status, headers } = await supertest(httpServer).get('/')
    assert.equal(status, 301)
    assert.equal(headers.location, '/dashboard')
  })

  test('redirect to a path with custom status code', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    server.use([])

    server.getRouter().on('/').redirectToPath('/dashboard', { status: 301 })
    await server.boot()

    const { status, headers } = await supertest(httpServer).get('/')
    assert.equal(status, 301)
    assert.equal(headers.location, '/dashboard')
  })
})

test.group('Server | middleware', () => {
  test('execute server middleware before route handler', async ({ assert }) => {
    const stack: string[] = []

    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    class LogMiddleware {
      handle(_: HttpContext, next: NextFn) {
        stack.push('fn1')
        return next()
      }
    }

    class LogMiddleware2 {
      handle(_: HttpContext, next: NextFn) {
        stack.push('fn2')
        return next()
      }
    }

    server.use([
      async () => {
        return {
          default: LogMiddleware,
        }
      },
      async () => {
        return {
          default: LogMiddleware2,
        }
      },
    ])

    server.getRouter().get('/', async () => {
      stack.push('handler')
      return 'done'
    })

    await server.boot()

    await supertest(httpServer).get('/').expect(200)
    assert.deepEqual(stack, ['fn1', 'fn2', 'handler'])
  })

  test('execute server middleware before route middleware and handler', async ({ assert }) => {
    const stack: string[] = []

    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    class LogMiddleware {
      handle(_: HttpContext, next: NextFn) {
        stack.push('fn1')
        return next()
      }
    }

    class LogMiddleware2 {
      handle(_: HttpContext, next: NextFn) {
        stack.push('fn2')
        return next()
      }
    }

    server.use([
      async () => {
        return {
          default: LogMiddleware,
        }
      },
      async () => {
        return {
          default: LogMiddleware2,
        }
      },
    ])

    server
      .getRouter()!
      .get('/', async () => {
        stack.push('handler')
        return 'done'
      })
      .middleware(async function routeMiddleware(_ctx: HttpContext, next: NextFn) {
        stack.push('route fn1')
        await next()
      })

    await server.boot()

    await supertest(httpServer).get('/').expect(200)
    assert.deepEqual(stack, ['fn1', 'fn2', 'route fn1', 'handler'])
  })

  test('terminate request from server middleware', async ({ assert }) => {
    const stack: string[] = []

    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    class LogMiddleware {
      handle(ctx: HttpContext, _: NextFn) {
        stack.push('fn1')
        ctx.response.send('completed')
      }
    }

    class LogMiddleware2 {
      handle(_: HttpContext, next: NextFn) {
        stack.push('fn2')
        return next()
      }
    }

    server.use([
      async () => {
        return {
          default: LogMiddleware,
        }
      },
      async () => {
        return {
          default: LogMiddleware2,
        }
      },
    ])

    server
      .getRouter()!
      .get('/', async () => {
        stack.push('handler')
        return 'done'
      })
      .middleware(async function routeMiddleware(_: HttpContext, next: NextFn) {
        stack.push('route fn1')
        await next()
      })

    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(200)
    assert.deepEqual(stack, ['fn1'])
    assert.equal(text, 'completed')
  })

  test('terminate request from server by raising exception', async ({ assert }) => {
    const stack: string[] = []

    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    class LogMiddleware {
      handle(__: HttpContext, _: NextFn) {
        stack.push('fn1')
        throw new Error('Something went wrong')
      }
    }

    class LogMiddleware2 {
      handle(_: HttpContext, next: NextFn) {
        stack.push('fn2')
        return next()
      }
    }

    server.use([
      async () => {
        return {
          default: LogMiddleware,
        }
      },
      async () => {
        return {
          default: LogMiddleware2,
        }
      },
    ])

    server
      .getRouter()!
      .get('/', async () => {
        stack.push('handler')
        return 'done'
      })
      .middleware(async function routeMiddleware(_: HttpContext, next: NextFn) {
        stack.push('route fn1')
        await next()
      })

    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(500)
    assert.deepEqual(stack, ['fn1'])
    assert.equal(text, 'Something went wrong')
  })

  test('run upstream code when server middleware raises an exception', async ({ assert }) => {
    const stack: string[] = []

    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    class LogMiddleware {
      async handle(_: HttpContext, next: NextFn) {
        stack.push('fn1')
        await next()
        stack.push('fn1 upstream')
      }
    }

    class LogMiddleware2 {
      handle(_: HttpContext) {
        stack.push('fn2')
        throw new Error('Something went wrong')
      }
    }

    server.use([
      async () => {
        return {
          default: LogMiddleware,
        }
      },
      async () => {
        return {
          default: LogMiddleware2,
        }
      },
    ])

    server
      .getRouter()!
      .get('/', async () => {
        stack.push('handler')
        return 'done'
      })
      .middleware(async function routeMiddleware(_ctx: HttpContext, next: NextFn) {
        stack.push('route fn1')
        await next()
      })

    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(500)
    assert.equal(text, 'Something went wrong')
    assert.deepEqual(stack, ['fn1', 'fn2', 'fn1 upstream'])
  })

  test('run upstream code when route middleware raises an exception', async ({ assert }) => {
    const stack: string[] = []

    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    class LogMiddleware {
      async handle(_: HttpContext, next: NextFn) {
        stack.push('fn1')
        await next()
        stack.push('fn1 upstream')
      }
    }

    class LogMiddleware2 {
      async handle(_: HttpContext, next: NextFn) {
        stack.push('fn2')
        await next()
        stack.push('fn2 upstream')
      }
    }

    server.use([
      async () => {
        return {
          default: LogMiddleware,
        }
      },
      async () => {
        return {
          default: LogMiddleware2,
        }
      },
    ])

    server
      .getRouter()!
      .get('/', async () => {
        stack.push('handler')
        return 'done'
      })
      .middleware(async function routeMiddleware(_ctx: HttpContext) {
        stack.push('route fn1')
        throw new Error('Something went wrong')
      })

    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(500)
    assert.equal(text, 'Something went wrong')
    assert.deepEqual(stack, ['fn1', 'fn2', 'route fn1', 'fn2 upstream', 'fn1 upstream'])
  })

  test('run upstream code when route handler raises an exception', async ({ assert }) => {
    const stack: string[] = []

    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    class LogMiddleware {
      async handle(_: HttpContext, next: NextFn) {
        stack.push('fn1')
        await next()
        stack.push('fn1 upstream')
      }
    }

    class LogMiddleware2 {
      async handle(_: HttpContext, next: NextFn) {
        stack.push('fn2')
        await next()
        stack.push('fn2 upstream')
      }
    }

    server.use([
      async () => {
        return {
          default: LogMiddleware,
        }
      },
      async () => {
        return {
          default: LogMiddleware2,
        }
      },
    ])

    server
      .getRouter()!
      .get('/', async () => {
        stack.push('handler')
        throw new Error('Something went wrong')
      })
      .middleware(async function routeMiddleware(_ctx: HttpContext, next: NextFn) {
        stack.push('route fn1')
        await next()
        stack.push('route fn1 upstream')
      })

    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(500)
    assert.equal(text, 'Something went wrong')
    assert.deepEqual(stack, [
      'fn1',
      'fn2',
      'route fn1',
      'handler',
      'route fn1 upstream',
      'fn2 upstream',
      'fn1 upstream',
    ])
  })
})

test.group('Server | error handler', () => {
  test('pass server middleware errors to the error handler', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    class ErrorHandler {
      report() {}
      handle(error: any, { response }: HttpContext) {
        assert.equal(error.message, 'Something went wrong')
        response.status(200).send('handled by error handler')
      }
    }

    class LogMiddleware {
      handle() {
        throw new Error('Something went wrong')
      }
    }

    server.use([
      async () => {
        return {
          default: LogMiddleware,
        }
      },
    ])

    server.errorHandler(async () => {
      return {
        default: ErrorHandler,
      }
    })

    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(200)
    assert.equal(text, 'handled by error handler')
  })

  test('pass router middleware errors to the error handler', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    class ErrorHandler {
      report() {}
      handle(error: any, { response }: HttpContext) {
        assert.equal(error.message, 'Something went wrong')
        response.status(200).send('handled by error handler')
      }
    }

    class LogMiddleware {
      handle() {
        throw new Error('Something went wrong')
      }
    }

    server.getRouter().use([
      async () => {
        return {
          default: LogMiddleware,
        }
      },
    ])

    server.errorHandler(async () => {
      return {
        default: ErrorHandler,
      }
    })

    server.getRouter().get('/', () => {})
    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(200)
    assert.equal(text, 'handled by error handler')
  })

  test('pass named middleware errors to the error handler', async ({ assert }) => {
    class LogMiddleware {
      handle() {
        throw new Error('Something went wrong')
      }
    }

    const namedMiddleware = defineNamedMiddleware({
      auth: async () => {
        return {
          default: LogMiddleware,
        }
      },
    })

    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))

    await app.init()

    class ErrorHandler {
      report() {}
      handle(error: any, { response }: HttpContext) {
        assert.equal(error.message, 'Something went wrong')
        response.status(200).send('handled by error handler')
      }
    }

    server.errorHandler(async () => {
      return {
        default: ErrorHandler,
      }
    })

    server
      .getRouter()
      .get('/', () => {})
      .middleware(namedMiddleware.auth())

    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(200)
    assert.equal(text, 'handled by error handler')
  })

  test('pass route handler errors to the error handler', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    class ErrorHandler {
      report() {}
      handle(error: any, { response }: HttpContext) {
        assert.equal(error.message, 'Something went wrong')
        response.status(200).send('handled by error handler')
      }
    }

    server.use([])

    server.errorHandler(async () => {
      return {
        default: ErrorHandler,
      }
    })

    server.getRouter().get('/', () => {
      throw new Error('Something went wrong')
    })
    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(200)
    assert.equal(text, 'handled by error handler')
  })

  test('report response serialization errors', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    server.use([])
    server.getRouter().get('/', async () => {
      return {
        toJSON() {
          throw new Error('blowup')
        },
      }
    })

    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(500)
    assert.equal(text, 'blowup')
  })

  test('report when error handler raises exception', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    class ErrorHandler {
      report() {}
      handle() {
        throw new Error('Error handler also failed')
      }
    }

    server.use([])
    server.getRouter().get('/', async () => {
      throw new Error('Route failed')
    })

    server.errorHandler(async () => {
      return {
        default: ErrorHandler,
      }
    })

    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(500)
    assert.equal(text, 'Error handler also failed')
  })

  test('raise 404 when route is missing', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    server.use([])
    await server.boot()

    const { text } = await supertest(httpServer).get('/').expect(404)
    assert.equal(text, 'Cannot GET:/')
  })
})

test.group('Server | force content negotiation', () => {
  test('find if the signed url signature is valid', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory().merge({ app }).create()
    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    server.use([])

    server
      .getRouter()!
      .get('/users/:id', async ({ request }) => {
        return {
          hasValidSignature: request.hasValidSignature(),
        }
      })
      .as('showUser')

    await server.boot()

    /**
     * Make a signed url
     */
    const url = server.getRouter().makeSignedUrl('showUser', [1], {
      qs: { site: 1, db: 'pg', dbUser: 1 },
    })

    const { body } = await supertest(httpServer).get(url).expect(200)
    assert.deepEqual(body, { hasValidSignature: true })
  }).tags(['regression'])

  test('access context from the async local storage', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory()
      .merge({
        app,
        config: {
          generateRequestId: true,
          useAsyncLocalStorage: true,
        },
      })
      .create()

    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    server.use([])

    server.getRouter().get('/', async (ctx) => {
      return {
        enabled: HttpContext.usingAsyncLocalStorage,
        get: HttpContext.get() === ctx,
        getOrFail: HttpContext.getOrFail() === ctx,
      }
    })

    await server.boot()

    assert.strictEqual(HttpContext.usingAsyncLocalStorage, true)
    assert.strictEqual(HttpContext.get(), null)
    assert.throws(
      () => HttpContext.getOrFail(),
      'Http context is not available outside of an HTTP request'
    )

    const { body, headers } = await supertest(httpServer).get('/').expect(200)
    assert.deepEqual(body, {
      enabled: true,
      get: true,
      getOrFail: true,
    })

    assert.exists(headers['x-request-id'])
  })

  test('run a callback outside the ALS context', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory()
      .merge({
        app,
        config: {
          useAsyncLocalStorage: true,
        },
      })
      .create()

    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    server.use([])

    server.getRouter().get('/', async (ctx) => {
      return HttpContext.runOutsideContext(() => {
        return {
          enabled: HttpContext.usingAsyncLocalStorage,
          get: HttpContext.get() === ctx,
        }
      })
    })

    await server.boot()

    const { body } = await supertest(httpServer).get('/').expect(200)
    assert.deepEqual(body, {
      enabled: true,
      get: false,
    })
  })

  test('disallow async local storage access when not enabled', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory()
      .merge({
        app,
        config: {
          useAsyncLocalStorage: false,
        },
      })
      .create()

    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    server.use([])

    server.getRouter().get('/', async () => {
      return {
        enabled: HttpContext.usingAsyncLocalStorage,
        get: HttpContext.get() === null,
      }
    })

    server.getRouter().get('/fail', async () => {
      return HttpContext.getOrFail()
    })

    await server.boot()

    assert.strictEqual(HttpContext.usingAsyncLocalStorage, false)
    assert.strictEqual(HttpContext.get(), null)
    assert.throws(
      () => HttpContext.getOrFail(),
      'HTTP context is not available. Enable "useAsyncLocalStorage" inside "config/app.ts" file'
    )

    const { body } = await supertest(httpServer).get('/').expect(200)
    assert.deepEqual(body, {
      enabled: false,
      get: true,
    })

    const { text } = await supertest(httpServer).get('/fail').expect(500)
    assert.strictEqual(
      text,
      'HTTP context is not available. Enable "useAsyncLocalStorage" inside "config/app.ts" file'
    )
  })

  test('run a callback outside the ALS context', async ({ assert }) => {
    const app = new AppFactory().create(BASE_URL, () => {})
    const server = new ServerFactory()
      .merge({
        app,
        config: {
          useAsyncLocalStorage: false,
        },
      })
      .create()

    const httpServer = createServer(server.handle.bind(server))
    await app.init()

    server.use([])

    server.getRouter().get('/', async (ctx) => {
      return HttpContext.runOutsideContext(() => {
        return {
          enabled: HttpContext.usingAsyncLocalStorage,
          get: HttpContext.get() === ctx,
        }
      })
    })

    await server.boot()

    const { body } = await supertest(httpServer).get('/').expect(200)
    assert.deepEqual(body, {
      enabled: false,
      get: false,
    })
  })
})

test.group('Server | Pipeline', () => {
  test('execute middleware pipeline', async ({ assert }) => {
    const stack: string[] = []
    const app = new AppFactory().create(BASE_URL, () => {})
    await app.init()

    const server = new ServerFactory().merge({ app }).create()

    class MiddlewareOne {
      handle(_: any, next: NextFn) {
        stack.push('middleware one')
        return next()
      }
    }

    class MiddlewareTwo {
      handle(_: any, next: NextFn) {
        stack.push('middleware two')
        return next()
      }
    }

    const req = new IncomingMessage(new Socket())
    const res = new ServerResponse(req)

    const ctx = server.createHttpContext(
      server.createRequest(req, res),
      server.createResponse(req, res),
      app.container.createResolver()
    )

    await server.pipeline([MiddlewareOne, MiddlewareTwo]).run(ctx)
    assert.deepEqual(stack, ['middleware one', 'middleware two'])
  })

  test('run final handler', async ({ assert }) => {
    const stack: string[] = []
    const app = new AppFactory().create(BASE_URL, () => {})
    await app.init()

    const server = new ServerFactory().merge({ app }).create()

    class MiddlewareOne {
      handle(_: any, next: NextFn) {
        stack.push('middleware one')
        return next()
      }
    }

    class MiddlewareTwo {
      handle(_: any, next: NextFn) {
        stack.push('middleware two')
        return next()
      }
    }

    const req = new IncomingMessage(new Socket())
    const res = new ServerResponse(req)

    const ctx = server.createHttpContext(
      server.createRequest(req, res),
      server.createResponse(req, res),
      app.container.createResolver()
    )

    await server
      .pipeline([MiddlewareOne, MiddlewareTwo])
      .finalHandler(async () => {
        stack.push('final handler')
      })
      .run(ctx)

    assert.deepEqual(stack, ['middleware one', 'middleware two', 'final handler'])
  })

  test('run error handler when error is thrown', async ({ assert }) => {
    const stack: string[] = []
    const app = new AppFactory().create(BASE_URL, () => {})
    await app.init()

    const server = new ServerFactory().merge({ app }).create()

    class MiddlewareOne {
      async handle(_: any, next: NextFn) {
        stack.push('middleware one')
        await next()
        stack.push('upstream middleware one')
      }
    }

    class MiddlewareTwo {
      handle(_: any, __: NextFn) {
        stack.push('middleware two')
        throw new Error('Fail')
      }
    }

    const req = new IncomingMessage(new Socket())
    const res = new ServerResponse(req)

    const ctx = server.createHttpContext(
      server.createRequest(req, res),
      server.createResponse(req, res),
      app.container.createResolver()
    )

    await server
      .pipeline([MiddlewareOne, MiddlewareTwo])
      .finalHandler(async () => {
        stack.push('final handler')
      })
      .errorHandler(async () => {
        stack.push('error handler')
      })
      .run(ctx)

    assert.deepEqual(stack, [
      'middleware one',
      'middleware two',
      'error handler',
      'upstream middleware one',
    ])
  })
})
