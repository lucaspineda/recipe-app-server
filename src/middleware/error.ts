import ApiError from '../utils/api-errors'
import { Application, Request, Response, NextFunction } from 'express';

interface ErrorMiddleware {
    (app: Application): void;
}

interface ErrorHandler {
    (error: any, req: Request, res: Response, next: NextFunction): void;
}

const errorMiddleware: ErrorMiddleware = async (app) => {
    const errorHandler: ErrorHandler = async (error, req, res, next) => {
        if (error as any) {
            return res.status(error.status).json({ message: error.message });
        }
        return res.status(500).json('AN INTERNAL SERVER ERROR HAPPENED!');
    };

    app.use(errorHandler);
};

export default errorMiddleware