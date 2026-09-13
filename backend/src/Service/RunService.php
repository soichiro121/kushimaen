<?php

declare(strict_types=1);

namespace Komato\Api\Service;

use Komato\Api\Config\RuleSet;
use Komato\Api\Domain\Run;
use Komato\Api\Domain\StageSubmission;
use Komato\Api\Domain\ValidationOutcome;
use Komato\Api\Http\ApiException;
use Komato\Api\Repository\RunRepository;
use Komato\Api\Repository\ScoreRepository;
use Komato\Api\Repository\StageResultRepository;
use Komato\Api\Support\Clock;
use Komato\Api\Support\Ids;
use Komato\Api\Support\Logger;
use Komato\Api\Validation\NicknameValidator;
use Komato\Api\Validation\StageResultValidator;
use PDO;

/**
 * Run lifecycle: open a run, then close it with a validated, recomputed score.
 *
 * The controller does none of this work itself - it parses the request and hands
 * over. That keeps the anti-cheat pipeline in one readable place:
 *
 *   request shape  ->  run state  ->  stage results  ->  score  ->  leaderboard
 */
final class RunService
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly RunRepository $runs,
        private readonly ScoreRepository $scores,
        private readonly StageResultRepository $stageResults,
        private readonly StageResultValidator $validator,
        private readonly NicknameValidator $nicknames,
        private readonly RuleSet $rules,
        private readonly Clock $clock,
        private readonly Logger $logger,
    ) {
    }

    /**
     * Opens a run. The seed and the id come from the server so the client can neither
     * pick a favourable seed nor invent a run that was never started.
     *
     * @return array{runId: string, seed: int, configVersion: int, expiresAt: string, serverTime: string}
     */
    public function createRun(): array
    {
        $now = $this->clock->now();
        $run = new Run(
            Ids::uuidV4(),
            Ids::seed(),
            $this->rules->configVersion(),
            $now,
            $now->modify('+' . $this->rules->runTtlSeconds() . ' seconds'),
            null,
            Run::STATUS_OPEN,
        );
        $this->runs->insert($run);

        return [
            'runId' => $run->id,
            'seed' => $run->seed,
            'configVersion' => $run->configVersion,
            'expiresAt' => $run->expiresAt->format(DATE_ATOM),
            'serverTime' => $now->format(DATE_ATOM),
        ];
    }

    /**
     * Closes a run and, if the submission holds up, records the score.
     *
     * @param list<StageSubmission> $stages
     * @return array{accepted: bool, totalScore: int, stageScores: array<string, int>, rank: int|null, notice?: string}
     */
    public function completeRun(string $runId, string $rawNickname, array $stages, int $clientTotal): array
    {
        $now = $this->clock->now();
        $run = $this->runs->find($runId);

        if ($run === null) {
            throw ApiException::notFound('unknown_run', 'この プレイ は見つかりませんでした');
        }
        if (!$run->isOpen()) {
            throw ApiException::conflict('run_already_completed', 'このプレイのスコアは登録済みです');
        }
        if ($run->isExpiredAt($now)) {
            // Close it so the id cannot be retried later.
            $this->runs->markCompleted($runId, $now, Run::STATUS_REJECTED);
            throw ApiException::gone('run_expired', 'プレイの有効期限が切れました。もう一度遊んでください');
        }
        if ($run->configVersion !== $this->rules->configVersion()) {
            throw ApiException::conflict(
                'config_version_mismatch',
                'ゲームが更新されました。ページを再読み込みしてください'
            );
        }

        $nicknameError = $this->nicknames->validate($rawNickname);
        if ($nicknameError !== null) {
            throw ApiException::unprocessable('invalid_nickname', 'ニックネームを確認してください');
        }
        $nickname = $this->nicknames->sanitize($rawNickname);

        $outcome = $this->validator->validate($stages);

        // One transaction: a run is either closed WITH its rows written, or neither.
        $this->pdo->beginTransaction();
        try {
            $claimed = $this->runs->markCompleted(
                $runId,
                $now,
                $outcome->valid ? Run::STATUS_COMPLETED : Run::STATUS_REJECTED,
            );
            if (!$claimed) {
                // Another request closed it between our check and this update.
                $this->pdo->rollBack();
                throw ApiException::conflict('run_already_completed', 'このプレイのスコアは登録済みです');
            }

            $this->stageResults->insertMany($runId, $stages, $outcome->stageScores);
            $this->scores->insert(
                $runId,
                $nickname,
                $outcome->totalScore,
                $now,
                $outcome->valid,
                $outcome->suspicionScore,
                $run->configVersion,
            );

            $this->pdo->commit();
        } catch (ApiException $exception) {
            throw $exception;
        } catch (\Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }

        $this->logSubmission($runId, $clientTotal, $outcome);

        $rank = $outcome->valid
            ? ($this->scores->placementOf($runId, 'all', $now)['rank'] ?? null)
            : null;

        $response = [
            'accepted' => $outcome->valid,
            'totalScore' => $outcome->totalScore,
            'stageScores' => $outcome->stageScores,
            'rank' => $rank,
        ];
        if (!$outcome->valid) {
            $response['notice'] = 'スコアを検証できませんでした';
        }

        return $response;
    }

    private function logSubmission(string $runId, int $clientTotal, ValidationOutcome $outcome): void
    {
        if ($outcome->valid && $outcome->issues === []) {
            return;
        }
        $this->logger->warning('suspicious submission', [
            'runId' => $runId,
            'clientTotal' => $clientTotal,
            'serverTotal' => $outcome->totalScore,
            'suspicion' => $outcome->suspicionScore,
            'issues' => $outcome->issuesToArray(),
        ]);
    }
}
