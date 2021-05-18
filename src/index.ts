import "reflect-metadata";
import "dotenv-safe/config";
import { COOKIE_NAME, __prod__ } from "./constants";
import express from "express";
import { ApolloServer } from "apollo-server-express";
import { buildSchema } from "type-graphql";
import { HelloResolver } from "./resolvers/hello";
import { PostResolver } from "./resolvers/post";
import { UserResolver } from "./resolvers/user";
import Redis from "ioredis";
import connectRedis from "connect-redis";
import session from "express-session";
import cors from "cors";
import { createConnection } from "typeorm";
import { Post } from "./entities/Post";
import { User } from "./entities/User";
import path from "path";
import { Updoot } from "./entities/Updoot";

// restart
const init = async () => {
  // how we wanna config the typeOrm connection
  // rerundf

  const conn = await createConnection({
    type: "postgres",
    // database: "lireddit",
    // username: "postgres",
    // password: "1234",
    url: process.env.DATABASE_URL,
    logging: true,
    entities: [Post, User, Updoot],
    // migrations: [path.join(__dirname, "./migrations/*")],
    // synchronize => automatically updats table so you don't need to make migrations
    synchronize: true,
  });

  await conn.runMigrations();
  // Post.delete({});

  // connecting to the db
  // const orm = await MikroORM.init(mikro_config);
  // migrate
  // await orm.getMigrator().up();

  // then do something
  //   create a post
  // const post = orm.em.create(Post, { title: "영산아 또 무얼하느냐" });
  // // const post = new Post('my first post'); 와 같다
  // await orm.em.persistAndFlush(post);

  //   codes down here don't work bc nativeInsert doesn't create a class
  //   console.log("---------------sql 2-----------------");
  //   await orm.em.nativeInsert(Post, { title: "my first post 2" });

  //   find posts
  //   const posts = await orm.em.find(Post, {});
  //   console.log(posts);

  const app = express();

  // test express app
  //   app.get("/", (req, res) => {});
  //   make end-point

  //   underscore means ignore the argument
  //   app.get("/", (_, res) => {
  //     res.send("hello");
  //   });

  //let RedisStore = require('connect-redis')(session)
  const RedisStore = connectRedis(session);
  const redis = new Redis(process.env.REDIS_URL);

  // telling that we have 1 proxy sitting in front
  // so cookies and sessions could work
  app.set("trust proxy", 1);
  // 순서가 중요하다 -> 써 있는 순서대로 작동되기 때문에
  // express init -> store data -> apollo uses the data
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN,
      credentials: true,
    })
  );
  app.use(
    session({
      // this is setting part
      name: COOKIE_NAME,
      // score means where we store the data
      // in this case, we are using redis store
      store: new RedisStore({
        client: redis as any,
        // how long do you want your data to last
        disableTouch: true,
      }),
      // secret is how you store and hide the data
      secret: process.env.SESSION_SECRET,
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 365 * 10, // 10 years
        // front-end cannot access to cookies
        sameSite: "lax", //csrf
        httpOnly: true,
        secure: __prod__, // cookie only works in https, not even in localhost
        domain: __prod__ ? ".dailykoding.xyz" : undefined,
      },
      // would you like to keep pinging redis?
      resave: false,
    })
  );

  const apolloServer = new ApolloServer({
    schema: await buildSchema({
      resolvers: [HelloResolver, PostResolver, UserResolver],
      validate: false,
    }),
    // constext is special object which is accessible by all your resolvers
    // when you update the this line below, update types.ts too
    context: ({ req, res }) => ({
      // since we don't use mikro-orm anymore we can just comment it
      // em: orm.em,
      req,
      res,
      redis,
    }),
  });

  apolloServer.applyMiddleware({
    app,
    cors: false,
  });

  // start the server
  app.listen(parseInt(process.env.PORT), () => {
    console.log("server started on http://localhost:4000");
  });
};

init().catch((err) => {
  console.error(err);
});
