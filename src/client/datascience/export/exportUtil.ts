import { inject, injectable } from 'inversify';
import * as os from 'os';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { Uri } from 'vscode';
import { IFileSystem, TemporaryDirectory } from '../../common/platform/types';
import { ICell, IDataScienceErrorHandler, INotebookExporter, INotebookModel, INotebookStorage } from '../types';

@injectable()
export class ExportUtil {
    constructor(
        @inject(IFileSystem) private fileSystem: IFileSystem,
        @inject(IDataScienceErrorHandler) private readonly errorHandler: IDataScienceErrorHandler,
        @inject(INotebookStorage) private notebookStorage: INotebookStorage,
        @inject(INotebookExporter) private jupyterExporter: INotebookExporter
    ) {}

    public async generateTempDir(): Promise<TemporaryDirectory> {
        const resultDir = path.join(os.tmpdir(), uuid());
        await this.fileSystem.createDirectory(resultDir);

        return {
            path: resultDir,
            dispose: async () => {
                // Try ten times. Process may still be up and running.
                // We don't want to do async as async dispose means it may never finish and then we don't
                // delete
                let count = 0;
                while (count < 10) {
                    try {
                        await this.fileSystem.deleteDirectory(resultDir);
                        count = 10;
                    } catch {
                        count += 1;
                    }
                }
            }
        };
    }

    public async makeFileInDirectory(model: INotebookModel, fileName: string, dirPath: string): Promise<string> {
        const newFilePath = path.join(dirPath, fileName);

        try {
            const content = model ? model.getContent() : '';
            await this.fileSystem.writeFile(newFilePath, content, 'utf-8');
        } catch (e) {
            await this.errorHandler.handleError(e);
        }

        return newFilePath;
    }

    public async getModelFromCells(cells: ICell[]): Promise<INotebookModel> {
        const tempDir = await this.generateTempDir();
        const tempFile = await this.fileSystem.createTemporaryFile('.ipynb');
        let model: INotebookModel;

        try {
            await this.jupyterExporter.exportToFile(cells, tempFile.filePath, false);
            const newPath = path.join(tempDir.path, '.ipynb');
            await this.fileSystem.copyFile(tempFile.filePath, newPath);
            model = await this.notebookStorage.load(Uri.file(newPath));
        } finally {
            tempFile.dispose();
            tempDir.dispose();
        }

        return model;
    }
}
