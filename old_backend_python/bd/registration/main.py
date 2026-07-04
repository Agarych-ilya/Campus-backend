from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

from auth import login_user, register_user
from db import init_db


app = FastAPI(
    title="Campus App Backend",
    version="0.1.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=6, max_length=100)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=100)


@app.on_event("startup")
def startup():
    init_db()


@app.get("/health")
def health_check():
    return {
        "status": "ok",
    }


@app.post("/auth/register", status_code=status.HTTP_201_CREATED)
def register(request: RegisterRequest):
    success, message = register_user(
        request.username,
        str(request.email),
        request.password,
    )

    if not success:
        if "email" in message.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=message,
            )

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message,
        )

    return {
        "message": message,
    }


@app.post("/auth/login")
def login(request: LoginRequest):
    success, result = login_user(
        str(request.email),
        request.password,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=result,
        )

    return {
        "message": "Вход выполнен",
        "user": result,
    }