import { TomlTaskProvider } from './tomlTaskProvider';
import constants from '../libs/constants';

export class PipenvTaskProvider extends TomlTaskProvider {
    constructor() {
        super('pipenv');
    }

    protected getGlobPatterns(): string[] {
        return [constants.GLOB_PIPENV];
    }

    protected getScriptsPath(): string {
        return 'scripts';
    }
}
