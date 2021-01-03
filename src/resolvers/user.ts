import { User } from "../entities/User";
import { MyContext } from "../types";
import {
  Arg,
  Ctx,
  Field,
  FieldResolver,
  InputType,
  Mutation,
  ObjectType,
  Query,
  Resolver,
  Root,
} from "type-graphql";
import argon2 from "argon2";
// import { EntityManager } from "@mikro-orm/postgresql";
import { COOKIE_NAME, FORGOT_PASSWORD_PREFIX } from "../constants";
import { sendEmail } from "../utils/sendEmail";
import { v4 } from "uuid";
import { Post } from "../entities/Post";
import { FieldError } from "./FieldError";

@InputType()
class UsernamePasswordInput {
  @Field()
  username: string;
  @Field()
  password: string;
  @Field()
  email: string;
}

@ObjectType()
class UserResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[];
  @Field(() => User, { nullable: true })
  user?: User;
}

@Resolver(User)
export class UserResolver {
  @FieldResolver()
  email(@Root() user: User, @Ctx() { req }: MyContext) {
    if (req.session!.userId === user.id) {
      return user.email;
    }
    return "";
  }
  @Query(() => [User])
  users(): Promise<User[]> {
    return User.find();
  }

  @Query(() => User, { nullable: true })
  async me(@Ctx() { req }: MyContext): Promise<User | undefined> {
    console.log(req.session);
    if (!req.session!.userId) {
      return undefined;
    }
    // return await em.findOne(User, { id: req.session!.userId });
    return await User.findOne(req.session!.userId);
  }
  @Mutation(() => UserResponse)
  async register(
    @Arg("input") input: UsernamePasswordInput,
    @Ctx() { req }: MyContext
  ) {
    if (input.username.length <= 2) {
      return {
        errors: [
          {
            field: "username",
            message: "username is too short",
          },
        ],
      };
    }
    if (input.password.length <= 2) {
      return {
        errors: [
          {
            field: "password",
            message: "password is too short",
          },
        ],
      };
    }
    if (!input.email.includes("@")) {
      return {
        errors: [
          {
            field: "email",
            message: "wrong email pattern",
          },
        ],
      };
    }
    const hash = await argon2.hash(input.password);
    // const user = em.create(User, { username: input.username, password: hash });
    let user;
    try {
      // typeorm querybuilder
      // const result = await getConnection()
      //   .createQueryBuilder()
      //   .insert()
      //   .into(User)
      //   .values({
      //     username: input.username,
      //     password: hash,
      //     email: input.email,
      //   })
      //   .returning("*")
      //   .execute();
      // user = result.raw[0];

      user = await User.create({
        username: input.username,
        password: hash,
        email: input.email,
      }).save();
      console.log(user.id);
    } catch (err) {
      console.log(err.detail);
      const detail = err.detail;
      if (detail.includes("(email)")) {
        return {
          errors: [{ field: "email", message: "email is already taken" }],
        };
      } else if (detail.includes("(username)")) {
        return {
          errors: [{ field: "username", message: "username is already taken" }],
        };
      }
    }
    req.session!.userId = user?.id;
    return { user };
  }

  @Mutation(() => UserResponse)
  async login(
    @Arg("usernameOrEmail") usernameOrEmail: string,
    @Arg("password") password: string,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    //find user
    const user = await User.findOne(
      usernameOrEmail.includes("@")
        ? { where: { email: usernameOrEmail } }
        : { where: { username: usernameOrEmail } }
    );
    console.log(user);
    if (!user) {
      //user doesn't exist
      return {
        errors: [
          {
            field: "usernameOrEmail",
            message: "that user doesn't exist",
          },
        ],
      };
    }

    const valid = await argon2.verify(user.password, password);
    if (!valid) {
      //
      return {
        errors: [
          {
            field: "password",
            message: "incorrect password",
          },
        ],
      };
    }
    // store user.id as userId in session
    req.session!.userId = user?.id;

    return { user };
  }

  @Mutation(() => Boolean)
  async deleteUser(
    @Arg("id") id: number,
    @Ctx() { req, res }: MyContext
  ): Promise<Boolean> {
    try {
      await Post.delete({ creatorId: id });
      await User.delete(id);
      return new Promise((resolve) =>
        // session.destroy => remove user info from redis
        req.session?.destroy((err) => {
          {
            if (err) {
              console.log(err);
              return resolve(false);
            }
            // this would clear the cookie
            res.clearCookie(COOKIE_NAME);
            return resolve(true);
          }
        })
      );
    } catch (err) {
      console.log(err);
      return false;
    }
  }

  // log out mutation
  @Mutation(() => Boolean)
  logout(@Ctx() { req, res }: MyContext): Promise<Boolean> {
    // things to do
    // 1. remove user info from redis
    // 2. delete the cookie

    // session.destroy needs a callback function
    // and we need to return Promise as we decleared above
    // Promise accepts callback function with 2 parameter (resolve, reject)
    // resolve for success handler
    // reject for failure handler
    return new Promise((resolve) =>
      // session.destroy => remove user info from redis
      req.session?.destroy((err) => {
        {
          if (err) {
            console.log(err);
            return resolve(false);
          }
          // this would clear the cookie
          res.clearCookie(COOKIE_NAME);
          return resolve(true);
        }
      })
    );
  }

  @Mutation(() => Boolean)
  async forgotPassword(
    @Arg("email") email: string,
    @Ctx() { redis }: MyContext
  ) {
    // const user = await em.findOne(User, { email });
    const user = await User.findOne({ where: { email } });
    if (!user) {
      // that user doesn't exist
      // just send true for security's sake
      // return true;
      return false;
    }

    // create a token
    const token = v4();
    // save the token in ioredis
    const key = FORGOT_PASSWORD_PREFIX + token;
    await redis.set(key, user.id, "ex", 1000 * 60 * 60 * 24 * 3); // 3 days
    // send the link with token
    const link = `http://localhost:3000/change-password/${token}`;
    const text = `
    you fucking idiot, you've forgotten it again!<br />
    
    <a href=${link}>click here to change your password</ a>
    <br />${link}
    `;
    sendEmail(email, text);
    return true;
  }

  @Mutation(() => UserResponse)
  async changePassword(
    @Arg("token") token: string,
    @Arg("newPassword") newPassword: string,
    @Ctx() { redis, req }: MyContext
  ): Promise<UserResponse> {
    // 1st. get user
    const key = FORGOT_PASSWORD_PREFIX + token;
    const userId = await redis.get(key);
    if (!userId) {
      //user doesn't exist
      return {
        errors: [
          {
            field: "token",
            message: "token has been expired",
          },
        ],
      };
    }
    // const user = await em.findOne(User, { id: parseInt(userId) });
    const user = await User.findOne(parseInt(userId));
    if (!user) {
      //user doesn't exist
      return {
        errors: [
          {
            field: "token",
            message: "that user doesn't exist",
          },
        ],
      };
    }
    // 2nd. set new password
    const hash = await argon2.hash(newPassword);
    // user.password = hash;
    // em.persistAndFlush(user);
    User.update({ id: parseInt(userId) }, { password: hash });

    // then delete the token
    await redis.del(key);
    // store user.id as userId in session
    req.session!.userId = user.id;

    return { user };
  }
}
