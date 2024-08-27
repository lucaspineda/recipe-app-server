import ApiError from '../utils/api-errors.ts'

const errorMiddleware = async app => {

    app.use(async (error, res, req, next) => {

        if (error instanceof ApiError)
            return res.status(res.status).json(res.msg)

        return res.status(500).json('AN INTERNAL SERVER ERROR HAPPENED!')
    })
}

export default errorMiddleware