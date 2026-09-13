<?php

declare(strict_types=1);

namespace Komato\Api\Middleware;

use JsonException;
use Komato\Api\Http\ApiException;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Parses JSON request bodies, with a hard size cap.
 *
 * The cap is the first line of defence: without it a client could stream megabytes
 * into `json_decode` and exhaust the worker's memory. A completed run is a few KB.
 */
final class JsonBodyMiddleware implements MiddlewareInterface
{
    private const MAX_BODY_BYTES = 65536;
    private const MAX_DEPTH = 16;

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        if (!in_array($request->getMethod(), ['POST', 'PUT', 'PATCH'], true)) {
            return $handler->handle($request);
        }

        $declared = (int) ($request->getHeaderLine('Content-Length') ?: 0);
        if ($declared > self::MAX_BODY_BYTES) {
            throw ApiException::payloadTooLarge('リクエストが大きすぎます');
        }

        $contentType = strtolower(explode(';', $request->getHeaderLine('Content-Type'))[0] ?? '');
        if ($contentType !== '' && $contentType !== 'application/json') {
            throw ApiException::badRequest('unsupported_media_type', 'Content-Type must be application/json');
        }

        $body = $request->getBody();
        $body->rewind();
        // Read one byte past the limit so an undeclared oversize body is still caught.
        $raw = $body->read(self::MAX_BODY_BYTES + 1);
        if (strlen($raw) > self::MAX_BODY_BYTES) {
            throw ApiException::payloadTooLarge('リクエストが大きすぎます');
        }

        if (trim($raw) === '') {
            return $handler->handle($request->withParsedBody([]));
        }

        try {
            $decoded = json_decode($raw, true, self::MAX_DEPTH, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw ApiException::badRequest('invalid_json', 'リクエストの形式が正しくありません');
        }

        return $handler->handle($request->withParsedBody($decoded));
    }
}
