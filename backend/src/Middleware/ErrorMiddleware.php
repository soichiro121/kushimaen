<?php

declare(strict_types=1);

namespace Komato\Api\Middleware;

use Komato\Api\Config\Env;
use Komato\Api\Http\ApiException;
use Komato\Api\Http\Json;
use Komato\Api\Support\Logger;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Slim\Exception\HttpMethodNotAllowedException;
use Slim\Exception\HttpNotFoundException;
use Throwable;

/**
 * Turns every exception into a JSON error response.
 *
 * Information-leak policy: an `ApiException` carries a message written for players
 * and is safe to return. Anything else is logged in full and answered with a generic
 * 500, so a database or filesystem error can never expose a table name, a query, a
 * path, or a stack trace to the internet.
 */
final class ErrorMiddleware implements MiddlewareInterface
{
    public function __construct(
        private readonly ResponseFactoryInterface $responseFactory,
        private readonly Logger $logger,
    ) {
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        try {
            return $handler->handle($request);
        } catch (ApiException $exception) {
            return Json::error(
                $this->response(),
                $exception->status,
                $exception->errorCode,
                $exception->getMessage(),
                $exception->details,
            );
        } catch (HttpNotFoundException) {
            return Json::error($this->response(), 404, 'not_found', 'エンドポイントが見つかりません');
        } catch (HttpMethodNotAllowedException) {
            return Json::error($this->response(), 405, 'method_not_allowed', 'このメソッドは使用できません');
        } catch (Throwable $exception) {
            $this->logger->exception($exception, [
                'method' => $request->getMethod(),
                'path' => $request->getUri()->getPath(),
            ]);

            $message = Env::isProduction()
                ? 'サーバーエラーが発生しました'
                : $exception::class . ': ' . $exception->getMessage();

            return Json::error($this->response(), 500, 'internal_error', $message);
        }
    }

    private function response(): ResponseInterface
    {
        return $this->responseFactory->createResponse();
    }
}
