<?php

declare(strict_types=1);

namespace Komato\Api\Config;

use JsonException;
use RuntimeException;

/**
 * Typed access to the shared, versioned rule set.
 *
 * This is THE SAME FILE the TypeScript frontend imports
 * (`shared/game-rules/vN.json`). Reading it here rather than re-declaring the
 * numbers is what stops the client and the server disagreeing about a score.
 *
 * The frontend's counterpart is `src/config/rules.ts`.
 */
final class RuleSet
{
    /**
     * The rule-set version this build scores with.
     *
     * Bump it (and add the matching `vN.json`) whenever a change would move existing
     * scores. Completed runs keep the `config_version` they were played under, so the
     * leaderboard can tell the two generations apart.
     */
    public const CURRENT_VERSION = 3;

    /** @var array<string, mixed> */
    private array $data;

    /** @param array<string, mixed> $data */
    private function __construct(array $data)
    {
        $this->data = $data;
    }

    /**
     * Loads the rule set for a config version.
     *
     * The directory is resolved from `GAME_RULES_PATH` when set, otherwise from a
     * short list of layouts: the repository checkout, and a `shared/` copied next
     * to `backend/` on the server (see docs/DEPLOYMENT.md).
     */
    public static function load(int $configVersion = self::CURRENT_VERSION, ?string $directory = null): self
    {
        $candidates = $directory !== null
            ? [$directory]
            : array_filter([
                Env::getOptional('GAME_RULES_PATH'),
                dirname(__DIR__, 3) . '/shared/game-rules',   // repository checkout
                dirname(__DIR__, 2) . '/shared/game-rules',   // shared copied into backend/
                dirname(__DIR__, 4) . '/shared/game-rules',   // backend/ one level deeper
            ]);

        foreach ($candidates as $candidate) {
            $file = rtrim((string) $candidate, '/\\') . '/v' . $configVersion . '.json';
            if (!is_readable($file)) {
                continue;
            }
            $raw = file_get_contents($file);
            if ($raw === false) {
                continue;
            }
            try {
                /** @var array<string, mixed> $decoded */
                $decoded = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
            } catch (JsonException $exception) {
                throw new RuntimeException("Rule set {$file} is not valid JSON", 0, $exception);
            }

            if (($decoded['configVersion'] ?? null) !== $configVersion) {
                throw new RuntimeException(
                    "Rule set {$file} declares configVersion "
                    . var_export($decoded['configVersion'] ?? null, true)
                    . ", expected {$configVersion}"
                );
            }
            return new self($decoded);
        }

        throw new RuntimeException(
            'Could not locate the shared rule set. Set GAME_RULES_PATH in backend/.env '
            . 'to the directory containing v' . $configVersion . '.json.'
        );
    }

    public function configVersion(): int
    {
        return (int) $this->data['configVersion'];
    }

    /** @return list<string> */
    public function stageOrder(): array
    {
        /** @var list<string> $order */
        $order = $this->data['stageOrder'];
        return $order;
    }

    public function hasStage(string $stageId): bool
    {
        return isset($this->data['stages'][$stageId]);
    }

    /** @return array<string, mixed> */
    public function stage(string $stageId): array
    {
        if (!$this->hasStage($stageId)) {
            throw new RuntimeException("Unknown stage \"{$stageId}\" in the rule set");
        }
        /** @var array<string, mixed> $stage */
        $stage = $this->data['stages'][$stageId];
        return $stage;
    }

    /**
     * Reads a nested value with a dotted path, e.g. `stages.late.scoring.nearMissScore`.
     * Throws rather than defaulting: a missing rule is a deployment error, and
     * silently scoring with a 0 would corrupt the leaderboard.
     */
    public function value(string $path): float|int|string|bool
    {
        $node = $this->data;
        foreach (explode('.', $path) as $segment) {
            if (!is_array($node) || !array_key_exists($segment, $node)) {
                throw new RuntimeException("Missing rule \"{$path}\" in the rule set");
            }
            $node = $node[$segment];
        }
        if (is_array($node)) {
            throw new RuntimeException("Rule \"{$path}\" is a group, not a value");
        }
        /** @var float|int|string|bool $node */
        return $node;
    }

    public function int(string $path): int
    {
        return (int) $this->value($path);
    }

    public function runTtlSeconds(): int
    {
        return $this->int('run.ttlSeconds');
    }

    public function nicknameMinLength(): int
    {
        return $this->int('nickname.minLength');
    }

    public function nicknameMaxLength(): int
    {
        return $this->int('nickname.maxLength');
    }
}
