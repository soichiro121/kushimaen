<?php

declare(strict_types=1);

namespace Komato\Api\Http;

use Psr\Http\Message\ResponseInterface;

/** JSON response helper, so every endpoint encodes and labels responses identically. */
final class Json
{
    public static function write(ResponseInterface $response, mixed $data, int $status = 200): ResponseInterface
    {
        $payload = json_encode(
            $data,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        );
        $response->getBody()->write($payload);

        return $response
            ->withHeader('Content-Type', 'application/json; charset=utf-8')
            ->withHeader('Cache-Control', 'no-store')
            ->withStatus($status);
    }

    public static function error(
        ResponseInterface $response,
        int $status,
        string $code,
        string $message,
        array $details = [],
    ): ResponseInterface {
        $error = ['code' => $code, 'message' => $message];
        if ($details !== []) {
            $error['details'] = $details;
        }
        return self::write($response, ['error' => $error], $status);
    }
}
