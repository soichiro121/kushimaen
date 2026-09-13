<?php

declare(strict_types=1);

namespace Komato\Api;

use Komato\Api\Config\Database;
use Komato\Api\Config\Env;
use Komato\Api\Config\RuleSet;
use Komato\Api\Controller\HealthController;
use Komato\Api\Controller\LeaderboardController;
use Komato\Api\Controller\RunController;
use Komato\Api\Middleware\CorsMiddleware;
use Komato\Api\Middleware\ErrorMiddleware;
use Komato\Api\Middleware\JsonBodyMiddleware;
use Komato\Api\Middleware\RateLimitMiddleware;
use Komato\Api\Middleware\SecurityHeadersMiddleware;
use Komato\Api\Repository\RateLimitRepository;
use Komato\Api\Repository\RunRepository;
use Komato\Api\Repository\ScoreRepository;
use Komato\Api\Repository\StageResultRepository;
use Komato\Api\Service\LeaderboardService;
use Komato\Api\Service\RunService;
use Komato\Api\Support\Clock;
use Komato\Api\Support\Logger;
use Komato\Api\Support\SystemClock;
use Komato\Api\Validation\NicknameValidator;
use Komato\Api\Validation\StageResultValidator;
use Komato\Api\Validation\SubmissionRequestValidator;
use PDO;
use Slim\App;
use Slim\Factory\AppFactory as SlimAppFactory;

/**
 * Wires the application together.
 *
 * Plain constructor injection rather than a DI container: at this size a container
 * would add indirection without buying anything, and the wiring being visible in one
 * function is what lets the next maintainer follow a request end to end.
 *
 * The same factory builds the app for `public/index.php` and for the test suite, so
 * the tests exercise the real middleware stack.
 */
final class AppFactory
{
    public static function create(?PDO $pdo = null, ?Clock $clock = null): App
    {
        Env::bootstrap();

        $pdo ??= Database::connection();
        $clock ??= new SystemClock();
        $logger = Logger::default();

        $rules = RuleSet::load(Env::int('CONFIG_VERSION', RuleSet::CURRENT_VERSION));
        $scoreCalculator = new Service\ScoreCalculator($rules);

        $runRepository = new RunRepository($pdo);
        $scoreRepository = new ScoreRepository($pdo, $rules->configVersion());
        $stageResultRepository = new StageResultRepository($pdo);
        $rateLimitRepository = new RateLimitRepository($pdo);

        $runService = new RunService(
            $pdo,
            $runRepository,
            $scoreRepository,
            $stageResultRepository,
            new StageResultValidator($rules, $scoreCalculator),
            new NicknameValidator($rules),
            $rules,
            $clock,
            $logger,
        );
        $leaderboardService = new LeaderboardService($scoreRepository, $clock);

        $app = SlimAppFactory::create();
        $app->setBasePath(Env::get('API_BASE_PATH', ''));

        // Slim runs the LAST-added middleware FIRST, so this list reads
        // inside-out: routing is innermost (closest to the route) and the error
        // middleware is outermost, which is what lets it catch routing errors such
        // as 404/405 and turn them into JSON.
        $app->addRoutingMiddleware();
        $app->add(new RateLimitMiddleware($rateLimitRepository, $clock));
        $app->add(new JsonBodyMiddleware());
        $app->add(new CorsMiddleware($app->getResponseFactory()));
        $app->add(new SecurityHeadersMiddleware());
        $app->add(new ErrorMiddleware($app->getResponseFactory(), $logger));

        $runController = new RunController($runService, new SubmissionRequestValidator());
        $leaderboardController = new LeaderboardController($leaderboardService);
        $healthController = new HealthController($rules, $clock);

        $app->group('/api', function (\Slim\Routing\RouteCollectorProxy $group) use (
            $runController,
            $leaderboardController,
            $healthController,
        ): void {
            $group->get('/health', $healthController);
            $group->post('/runs', [$runController, 'create']);
            $group->post('/runs/{runId}/complete', [$runController, 'complete']);
            $group->get('/leaderboard', $leaderboardController);
        });

        return $app;
    }
}
