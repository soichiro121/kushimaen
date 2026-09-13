<?php

declare(strict_types=1);

namespace Komato\Api\Controller;

use Komato\Api\Http\ApiException;
use Komato\Api\Http\Json;
use Komato\Api\Service\RunService;
use Komato\Api\Validation\SubmissionRequestValidator;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * `POST /api/runs` and `POST /api/runs/{runId}/complete`.
 *
 * Controllers stay thin on purpose: parse, delegate, serialise. All the rules live in
 * the validators and `RunService`, which is what makes them testable without HTTP.
 */
final class RunController
{
    public function __construct(
        private readonly RunService $runs,
        private readonly SubmissionRequestValidator $requestValidator,
    ) {
    }

    public function create(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return Json::write($response, $this->runs->createRun(), 201);
    }

    /** @param array{runId?: string} $args */
    public function complete(
        ServerRequestInterface $request,
        ResponseInterface $response,
        array $args,
    ): ResponseInterface {
        $runId = $args['runId'] ?? '';
        if (!preg_match('/^[0-9a-fA-F-]{36}$/', $runId)) {
            throw ApiException::badRequest('invalid_run_id', 'run id の形式が正しくありません');
        }

        $parsed = $this->requestValidator->parse($request->getParsedBody());
        $result = $this->runs->completeRun(
            $runId,
            $parsed['nickname'],
            $parsed['stages'],
            $parsed['totalScore'],
        );

        // A rejected-but-understood submission is still a successful request: the
        // client needs the body to explain what happened.
        return Json::write($response, $result, 200);
    }
}
