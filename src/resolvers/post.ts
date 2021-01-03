import { Post } from "../entities/Post";
import {
  Arg,
  Ctx,
  Field,
  FieldResolver,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
  Root,
  UseMiddleware,
} from "type-graphql";
import { MyContext } from "../types";
import { isAuth } from "../middleware/isAuth";
import { getConnection } from "typeorm";
import { FieldError } from "./FieldError";
import { Updoot } from "../entities/Updoot";

@InputType()
class PostInput {
  @Field()
  title!: string;
  @Field()
  text!: string;
}

@ObjectType()
// return type for paginator
class PaginatedPosts {
  @Field(() => [Post])
  posts: Post[];
  @Field()
  hasMore: boolean;
}

@ObjectType()
class PostResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[];
  @Field(() => Post, { nullable: true })
  post?: Post;
}

@Resolver(Post)
export class PostResolver {
  @FieldResolver(() => String)
  textSnippet(@Root() post: Post) {
    return post.text.slice(0, 300);
  }
  @FieldResolver(() => Boolean)
  hasMoreText(@Root() post: Post) {
    return post.text.slice(301) !== "";
  }
  @FieldResolver(() => String)
  theRestText(@Root() post: Post) {
    return post.text.slice(301);
  }
  // graphql Type Post
  @Query(() => PaginatedPosts)
  async posts(
    @Arg("limit", () => Int) limit: number,
    @Arg("cursor", () => String, { nullable: true }) cursor: string | null,
    @Ctx() { req }: MyContext
  ): Promise<PaginatedPosts> {
    const realLimit = Math.min(50, limit);
    // we ask for extra posts to check if there are more
    const realLimitPlusOne = realLimit + 1;
    const replacements: any[] = [realLimitPlusOne];
    if (req.session?.userId) {
      replacements.push(req.session?.userId);
    }

    let cursorIdx = 3;
    if (cursor) {
      // if you want to use createdAt as the cursor
      // qb.where('p."createdAt" < :cursor', {
      // cursor: new Date(parseInt(cursor)),
      // });
      // qb.where('"points" < :cursor', {
      //   cursor: cursor,
      // });
      replacements.push(new Date(parseInt(cursor)));
      cursorIdx = replacements.length;
    }
    // const qb = getConnection()
    //   .getRepository(Post)
    //   .createQueryBuilder("p")
    //   .innerJoinAndSelect("p.creator", "u", 'u.id = p."creatorId"')
    //   .orderBy('p."createdAt"', "DESC")
    //   // we actually get 1 more post
    //   .take(realLimitPlusOne);

    // const posts = await qb.getMany();

    const posts = await getConnection().query(
      `
    select p.*,
    json_build_object(
      'id', u.id,
      'username', u.username,
      'email', u.email,
      'createdAt', u."createdAt",
      'updatedAt', u."updatedAt"
      ) creator,
      ${
        req.session?.userId
          ? '(select value from updoot where "userId" = $2 and "postId" = p.id) "voteStatus"'
          : 'null as "voteStatus"'
      }
    from post p
    inner join public.user u on u.id = p."creatorId"
    ${cursor ? `where p."createdAt" < $${cursorIdx}` : ""}
    order by p."createdAt" DESC
    limit $1
    `,
      replacements
    );
    // then we return minus 1 posts from realLimitPlusOne
    return {
      posts: posts.slice(0, realLimit),
      hasMore: posts.length === realLimitPlusOne,
    };
  }

  @Query(() => Post, { nullable: true })
  post(@Arg("id", () => Int) id: number): Promise<Post | undefined> {
    const post = Post.findOne(id, { relations: ["creator"] });
    return post;
  }

  @Mutation(() => PostResponse)
  // this middleware checks "isAuth" before this fn runs
  @UseMiddleware(isAuth)
  async createPost(
    @Arg("input") input: PostInput,
    @Ctx() { req }: MyContext
  ): Promise<Post> {
    // we could do like this
    // but we could do it with middleware
    // if (!req.session!.userId) {
    //   throw new Error("not authenticated");
    // }
    // if (input.title === "") {
    //   return {
    //     errors: [
    //       {
    //         field: "title",
    //         message: "you need to input title!",
    //       },
    //     ],
    //   };
    // }
    return Post.create({
      ...input,
      creatorId: req.session!.userId,
    }).save();
  }

  @Mutation(() => Post, { nullable: true })
  @UseMiddleware(isAuth)
  async updatePost(
    @Arg("id", () => Int) id: number,
    @Arg("title", () => String, { nullable: true }) title: string,
    @Arg("text", () => String, { nullable: true }) text: string,
    @Ctx() { req }: MyContext
  ): Promise<Post | null> {
    // const post = await em.findOne(Post, { id });
    const result = await getConnection()
      .createQueryBuilder()
      .update(Post)
      .set({ title, text })
      .where('id = :id and "creatorId" = :creatorId', {
        id,
        creatorId: req.session!.userId,
      })
      .returning("*")
      .execute();

    return result.raw[0];
  }

  @Mutation(() => Boolean)
  @UseMiddleware(isAuth)
  async deletePost(
    @Arg("id", () => Int) id: number,
    @Ctx() { req }: MyContext
  ): Promise<Boolean> {
    // const result = await em.nativeDelete(Post, { id });
    const post = await Post.findOne({ where: { id } });
    if (!post) {
      return false;
    }
    if (req.session?.userId !== post!.creatorId) {
      throw new Error("not authorized");
    }
    // await Updoot.delete({ postId: id });
    const result = await Post.delete(id);
    return Boolean(result);

    // await Post.delete({ id, creatorId: req.session!.userId });
    // return true;
  }

  @Mutation(() => Boolean)
  @UseMiddleware(isAuth)
  async vote(
    @Arg("postId", () => Int) postId: number,
    @Arg("value", () => Int) value: number,
    @Ctx() { req }: MyContext
  ) {
    const isUpdoot = value !== -1;
    const userId = req.session!.id;
    const _value = isUpdoot ? 1 : -1;

    const updoot = await Updoot.findOne({ where: { postId, userId } });
    if (updoot && updoot.value !== _value) {
      // already voted?
      // and they changed their vote?
      await getConnection().transaction(async (tm) => {
        await tm.query(
          `
          update updoot
          set value = $1
          where "postId" = $2 and "userId" = $3
        `,
          [_value, postId, userId]
        );

        await tm.query(
          `
          update post
          set points = points + $1
          where id = $2
        `,
          [2 * _value, postId]
        );
      });
    } else if (updoot && updoot.value === _value) {
      // already voted
      // and they want to cancel the vote
      await getConnection().transaction(async (tm) => {
        await tm.query(
          `
          delete from updoot
          where "postId" = $1 and "userId" = $2
        `,
          [postId, userId]
        );

        await tm.query(
          `
          update post
          set points = points - $1
          where id = $2
        `,
          [_value, postId]
        );
      });
    } else if (!updoot) {
      // never voted?
      // get user id, post id, value => update on updoot

      await getConnection().transaction(async (tm) => {
        tm.query(
          `
          insert into updoot ("userId", "postId", value)
          values ($1,$2,$3);
        `,
          [userId, postId, _value]
        );
        tm.query(
          `
          update post 
          set points = points + $1
          where id = $2;
        `,
          [_value, postId]
        );
      });
      return true;
    }
    return false;
    // const updoots = await Updoot.insert({
    //   userId,
    //   postId,
    //   value: _value,
    // })
    // await Post.update({
    //   id: postId,
    // }, {points: })
  }
}
